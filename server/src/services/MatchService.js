import { sendMessage } from '../channel/CommunicationChannel.js';

const PROMOTIONS = new Set(['queen', 'rook', 'bishop', 'knight']);

/**
 * Serviço das JOGADAS de uma partida online.
 *
 * O servidor é a fonte da verdade da ORDEM das jogadas: ele numera cada jogada (seq),
 * confere se é a vez de quem jogou, salva no banco e retransmite para os dois.
 * (As regras de xadrez — movimento legal, xeque etc. — são validadas no navegador.)
 */
export class MatchService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async handleMove(channel, color, socket, payload) {
    return channel.runExclusive(async () => {
      const rejectMove = (reason) => {
        sendMessage(socket, 'move_rejected', { reason });
        this.sendSync(channel, socket); // devolve o estado oficial para o cliente se corrigir
      };

      // Premissa: a partida só acontece com os 2 jogadores conectados
      if (!channel.isReady()) return rejectMove('OPPONENT_NOT_CONNECTED');

      const parsed = parseMove(payload);
      if (!parsed) return rejectMove('INVALID_MOVE');

      const { moves } = channel.state;
      const expectedColor = moves.length % 2 === 0 ? 'w' : 'b';
      if (color !== expectedColor) return rejectMove('NOT_YOUR_TURN');

      // Controle de concorrência otimista: o cliente diz qual número de jogada ele
      // acha que está fazendo. Se não bater, o cliente está desatualizado.
      const seq = moves.length + 1;
      if (payload.seq !== undefined && payload.seq !== seq) return rejectMove('OUT_OF_SYNC');

      const move = { seq, color, ...parsed };
      await this.repository.appendMove(channel.code, move);
      moves.push(move);
      channel.broadcast('move', { move });
    });
  }

  async handleReset(channel, color) {
    return channel.runExclusive(async () => {
      const resetCount = await this.repository.resetRoom(channel.code);
      channel.state.moves = [];
      channel.state.resetCount = resetCount;
      channel.broadcast('reset', { resetCount, by: color });
    });
  }

  /**
   * Encerra a partida porque um jogador saiu (ou caiu e não voltou a tempo).
   * Premissa: partida só existe com 2 jogadores — se sobrou só um, ela acaba.
   * A vaga de quem saiu é liberada, as jogadas são apagadas (nova partida) e o
   * jogador que ficou é avisado; a próxima partida começa quando alguém entrar.
   *
   * Roda na fila da sala (runExclusive): se o jogador reconectou antes disso,
   * nada acontece. Retorna true se a partida foi encerrada.
   */
  async endMatch(channel, leftColor, reason = 'PLAYER_LEFT') {
    return channel.runExclusive(async () => {
      if (channel.isConnected(leftColor)) return false;
      await this.repository.releaseSeat(channel.code, leftColor);
      const resetCount = await this.repository.resetRoom(channel.code);
      channel.state.moves = [];
      channel.state.resetCount = resetCount;
      channel.broadcast('match_ended', {
        reason,
        leftColor,
        resetCount,
        presence: channel.presence()
      });
      return true;
    });
  }

  sendSync(channel, socket) {
    sendMessage(socket, 'sync', {
      moves: channel.state.moves,
      resetCount: channel.state.resetCount,
      presence: channel.presence()
    });
  }
}

function isSquare(sq) {
  return (
    sq &&
    Number.isInteger(sq.r) &&
    Number.isInteger(sq.c) &&
    sq.r >= 0 && sq.r < 8 &&
    sq.c >= 0 && sq.c < 8
  );
}

function parseMove(payload) {
  if (!payload || !isSquare(payload.from) || !isSquare(payload.to)) return null;
  if (payload.from.r === payload.to.r && payload.from.c === payload.to.c) return null;
  const promotion = PROMOTIONS.has(payload.promotion) ? payload.promotion : 'queen';
  return {
    from: { r: payload.from.r, c: payload.from.c },
    to: { r: payload.to.r, c: payload.to.c },
    promotion
  };
}
