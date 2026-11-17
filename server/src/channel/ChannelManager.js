import { WebSocket } from 'ws';
import { CommunicationChannel, sendMessage } from './CommunicationChannel.js';
import {
  generateRoomCode,
  normalizeRoomCode,
  isValidPlayerToken
} from '../rooms/roomCode.js';

// Códigos de fechamento do WebSocket (faixa 4000-4999 é livre para a aplicação)
export const CLOSE_CODES = {
  BAD_REQUEST: 4400,
  ROOM_FULL: 4403,
  ROOM_NOT_FOUND: 4404
};

/**
 * CRIAÇÃO DO CANAL DE COMUNICAÇÃO entre os dois jogadores.
 *
 * Responsabilidades:
 *  1. Criar salas (gera o código de 5 caracteres que vai na URL).
 *  2. Receber cada nova conexão WebSocket, descobrir em qual sala e com qual cor
 *     ela entra, e recusar se a sala não existe ou já tem 2 jogadores.
 *  3. Criar (ou reaproveitar) o CommunicationChannel da sala e plugar o socket nele.
 *  4. Encaminhar cada mensagem recebida para o serviço responsável
 *     (chat -> ChatService, jogada -> MatchService).
 */
export class ChannelManager {
  constructor({
    repository,
    chatService,
    matchService,
    heartbeatMs = 30000,
    disconnectGraceMs = 5000
  }) {
    this.repository = repository;
    this.chatService = chatService;
    this.matchService = matchService;
    this.heartbeatMs = heartbeatMs;
    this.disconnectGraceMs = disconnectGraceMs;
    /** @type {Map<string, CommunicationChannel>} */
    this.channels = new Map();
  }

  /** Cria uma sala nova; quem cria joga de brancas. */
  async createRoom(playerToken) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateRoomCode();
      if (await this.repository.createRoom(code, playerToken)) return code;
    }
    throw new Error('Não foi possível gerar um código de sala único');
  }

  getOrCreateChannel(code) {
    let channel = this.channels.get(code);
    if (!channel) {
      channel = new CommunicationChannel(code);
      this.channels.set(code, channel);
    }
    return channel;
  }

  /** Liga o gerenciador ao servidor WebSocket. */
  attach(wss) {
    wss.on('connection', (socket, request) => {
      this.handleConnection(socket, request).catch((err) => {
        console.error('[ws] erro na conexão:', err);
        reject(socket, 'INTERNAL', 'Erro interno no servidor.', 1011);
      });
    });

    // Heartbeat: a cada intervalo enviamos um ping; quem não responder com pong
    // até o próximo ciclo é considerado desconectado (ex.: internet caiu).
    const timer = setInterval(() => {
      for (const socket of wss.clients) {
        if (socket.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }, this.heartbeatMs);
    wss.on('close', () => clearInterval(timer));
  }

  async handleConnection(socket, request) {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    const url = new URL(request.url, 'http://localhost');
    const code = normalizeRoomCode(url.searchParams.get('room'));
    const token = url.searchParams.get('token');
    if (!code || !isValidPlayerToken(token)) {
      return reject(socket, 'BAD_REQUEST', 'Código de sala ou token inválido.', CLOSE_CODES.BAD_REQUEST);
    }

    if (!(await this.repository.findRoom(code))) {
      return reject(socket, 'ROOM_NOT_FOUND', `A sala "${code}" não existe.`, CLOSE_CODES.ROOM_NOT_FOUND);
    }
    const chat = await this.chatService.history(code);

    // Escolha da vaga + conexão no canal rodam na fila da sala, para não cruzar com
    // jogadas nem com o encerramento de partida (endMatch), que libera vagas.
    const channel = this.getOrCreateChannel(code);
    const color = await channel.runExclusive(async () => {
      const room = await this.repository.findRoom(code);
      // Quem já tem lugar reconecta com a mesma cor; senão ocupa uma vaga livre.
      let seat = null;
      if (room?.whiteToken === token) seat = 'w';
      else if (room?.blackToken === token) seat = 'b';
      else if (room) seat = await this.repository.claimSeat(code, token);
      if (!seat) return null;

      if (!channel.state.loaded) {
        channel.state.moves = await this.repository.listMoves(code);
        channel.state.resetCount = room.resetCount;
        channel.state.loaded = true;
      }

      // O cliente pode ter desistido enquanto consultávamos o banco
      if (socket.readyState !== WebSocket.OPEN) {
        this.scheduleLeave(channel, seat);
        return null;
      }

      this.cancelLeave(channel, seat); // voltou dentro do prazo: a partida continua
      channel.attach(seat, socket);
      socket.on('message', (raw) => this.route(channel, seat, socket, raw));
      socket.on('close', () => {
        if (channel.detach(seat, socket)) {
          channel.broadcast('presence', channel.presence());
          this.scheduleLeave(channel, seat);
        }
        this.cleanup(channel);
      });

      sendMessage(socket, 'joined', {
        code,
        color: seat,
        presence: channel.presence(),
        moves: channel.state.moves,
        resetCount: channel.state.resetCount,
        chat
      });
      channel.broadcast('presence', channel.presence());
      return seat;
    });

    if (!color) {
      this.cleanup(channel);
      if (socket.readyState !== WebSocket.OPEN) return;
      return reject(
        socket,
        'ROOM_FULL',
        `A sala "${code}" já está com 2 jogadores.`,
        CLOSE_CODES.ROOM_FULL
      );
    }
    console.log(`[ws] sala ${code}: jogador ${color} conectado (${JSON.stringify(channel.presence())})`);
  }

  /**
   * Um jogador caiu: espera `disconnectGraceMs` para ele voltar (recarregar a página
   * não deve encerrar a partida). Se não voltar, a partida é encerrada.
   */
  scheduleLeave(channel, color) {
    this.cancelLeave(channel, color);
    const timer = setTimeout(() => {
      channel.leaveTimers.delete(color);
      this.finishMatch(channel, color, 'PLAYER_DISCONNECTED');
    }, this.disconnectGraceMs);
    timer.unref?.();
    channel.leaveTimers.set(color, timer);
  }

  cancelLeave(channel, color) {
    const timer = channel.leaveTimers.get(color);
    if (timer) clearTimeout(timer);
    channel.leaveTimers.delete(color);
  }

  /** O jogador clicou em "Sair da sala": encerra na hora, sem prazo de reconexão. */
  handleLeave(channel, color, socket) {
    channel.detach(color, socket);
    this.cancelLeave(channel, color);
    socket.close(1000, 'left');
    channel.broadcast('presence', channel.presence());
    return this.finishMatch(channel, color, 'PLAYER_LEFT');
  }

  finishMatch(channel, color, reason) {
    channel.pendingEnds += 1; // impede o cleanup de descartar o canal no meio do encerramento
    return this.matchService
      .endMatch(channel, color, reason)
      .then((ended) => {
        if (ended) console.log(`[ws] sala ${channel.code}: partida encerrada (${color} ${reason})`);
      })
      .catch((err) => console.error(`[ws] erro ao encerrar partida na sala ${channel.code}:`, err))
      .finally(() => {
        channel.pendingEnds -= 1;
        this.cleanup(channel);
      });
  }

  /** Encaminha a mensagem para o serviço responsável pelo tipo dela. */
  route(channel, color, socket, raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return sendMessage(socket, 'error', { code: 'BAD_MESSAGE', message: 'JSON inválido.' });
    }

    const { type, payload } = message || {};
    let work;
    switch (type) {
      case 'chat':
        work = this.chatService.handleIncoming(channel, color, payload);
        break;
      case 'move':
        work = this.matchService.handleMove(channel, color, socket, payload);
        break;
      case 'reset':
        work = this.matchService.handleReset(channel, color);
        break;
      case 'sync':
        work = this.matchService.sendSync(channel, socket);
        break;
      case 'leave':
        work = this.handleLeave(channel, color, socket);
        break;
      default:
        return sendMessage(socket, 'error', { code: 'UNKNOWN_TYPE', message: `Tipo "${type}" desconhecido.` });
    }
    Promise.resolve(work).catch((err) => {
      console.error(`[ws] erro ao processar "${type}" na sala ${channel.code}:`, err);
      sendMessage(socket, 'error', { code: 'INTERNAL', message: 'Erro interno no servidor.' });
    });
  }

  /**
   * Remove o canal da memória quando ninguém mais está nele e não há partida para
   * encerrar (o estado fica no banco).
   */
  cleanup(channel) {
    if (
      channel.isEmpty() &&
      channel.leaveTimers.size === 0 &&
      channel.pendingEnds === 0 &&
      this.channels.get(channel.code) === channel
    ) {
      this.channels.delete(channel.code);
    }
  }
}

function reject(socket, code, message, closeCode) {
  sendMessage(socket, 'error', { code, message, fatal: true });
  socket.close(closeCode, code);
}
