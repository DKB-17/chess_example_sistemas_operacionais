import { WebSocket } from 'ws';

/**
 * CANAL DE COMUNICAÇÃO entre os dois jogadores de uma sala.
 *
 * Cada sala ativa tem exatamente um CommunicationChannel, que guarda as conexões
 * WebSocket de cada lado (brancas 'w' e pretas 'b'). Ele é o "fio" por onde as
 * mensagens trafegam: enviar para um jogador, ou transmitir (broadcast) para os dois.
 *
 * Ele NÃO decide o que fazer com as mensagens — isso é papel dos serviços
 * (ChatService para o chat, MatchService para as jogadas).
 */
export class CommunicationChannel {
  /** Uma sala comporta no máximo 2 jogadores: uma conexão por cor. */
  static CAPACITY = 2;

  constructor(code) {
    this.code = code;
    /** @type {Map<'w'|'b', WebSocket>} */
    this.sockets = new Map();
    // Estado da partida em memória (carregado do banco quando o canal é criado)
    this.state = { loaded: false, moves: [], resetCount: 0 };
    // Jogadores que caíram e ainda estão no prazo para reconectar (cor -> timer)
    /** @type {Map<'w'|'b', ReturnType<typeof setTimeout>>} */
    this.leaveTimers = new Map();
    this.pendingEnds = 0; // encerramentos de partida em andamento
    // Fila para processar uma operação por vez (garante ordem das jogadas)
    this._queue = Promise.resolve();
  }

  /**
   * Conecta o socket de um jogador ao canal. Se o mesmo jogador já estava conectado
   * (ex.: recarregou a página), a conexão antiga é encerrada e substituída.
   */
  attach(color, socket) {
    const previous = this.sockets.get(color);
    if (previous && previous !== socket) {
      sendMessage(previous, 'error', {
        code: 'SESSION_REPLACED',
        message: 'Você abriu esta partida em outra aba/janela.'
      });
      previous.close(4001, 'session replaced');
    }
    this.sockets.set(color, socket);
  }

  /** Remove o socket do canal (só se ainda for o socket atual daquela cor). */
  detach(color, socket) {
    if (this.sockets.get(color) !== socket) return false;
    this.sockets.delete(color);
    return true;
  }

  isConnected(color) {
    const socket = this.sockets.get(color);
    return Boolean(socket) && socket.readyState === WebSocket.OPEN;
  }

  /** A partida só pode acontecer quando os DOIS jogadores estão conectados. */
  isReady() {
    return this.isConnected('w') && this.isConnected('b');
  }

  isEmpty() {
    return this.sockets.size === 0;
  }

  presence() {
    return { w: this.isConnected('w'), b: this.isConnected('b'), ready: this.isReady() };
  }

  /** Envia uma mensagem para um jogador específico. */
  send(color, type, payload) {
    const socket = this.sockets.get(color);
    if (socket) sendMessage(socket, type, payload);
  }

  /** Envia uma mensagem para todos os jogadores conectados na sala. */
  broadcast(type, payload) {
    for (const socket of this.sockets.values()) {
      sendMessage(socket, type, payload);
    }
  }

  /**
   * Executa `task` com exclusão mútua dentro da sala: tarefas entram numa fila e
   * rodam uma de cada vez, na ordem de chegada. Assim, duas jogadas que chegam
   * quase juntas nunca são processadas em paralelo (evita condição de corrida).
   */
  runExclusive(task) {
    const run = this._queue.then(task, task);
    this._queue = run.catch(() => {});
    return run;
  }
}

/** Protocolo: toda mensagem é um JSON { type, payload }. */
export function sendMessage(socket, type, payload = {}) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, payload }));
}
