// Fechamentos que NÃO devem gerar nova tentativa de conexão
// (sala cheia, sala inexistente, pedido inválido, sessão aberta em outra aba)
const FATAL_CLOSE_CODES = new Set([4001, 4400, 4403, 4404]);
const MAX_RECONNECT_DELAY_MS = 10000;

/**
 * CANAL DE COMUNICAÇÃO do navegador com o servidor (lado cliente).
 *
 * Abre o WebSocket da sala, transforma cada mensagem recebida em um evento
 * (on('chat', ...), on('move', ...)) e reconecta sozinho se a conexão cair.
 * Não sabe nada de xadrez nem de chat: só transporta mensagens { type, payload }.
 *
 * Eventos extras gerados localmente:
 *   'status' -> 'connecting' | 'open' | 'reconnecting' | 'closed'
 */
export class GameSocketChannel {
  constructor({ roomCode, playerToken, url = defaultSocketUrl() }) {
    this.roomCode = roomCode;
    this.playerToken = playerToken;
    this.url = url;
    this.socket = null;
    this.listeners = new Map();
    this.joined = false; // true depois que o servidor confirmou a entrada na sala
    this.closedByUser = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  connect() {
    this.closedByUser = false;
    const query = new URLSearchParams({ room: this.roomCode, token: this.playerToken });
    this.emit('status', this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const socket = new WebSocket(`${this.url}?${query}`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.emit('status', 'open');
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'joined') this.joined = true;
      this.emit(message.type, message.payload || {});
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.joined = false;
      this.socket = null;
      if (this.closedByUser || FATAL_CLOSE_CODES.has(event.code)) {
        this.emit('status', 'closed');
        return;
      }
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    this.reconnectAttempts += 1;
    // Backoff exponencial: 1s, 2s, 4s, 8s... (máx. 10s)
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** (this.reconnectAttempts - 1));
    this.emit('status', 'reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** Envia { type, payload }. Retorna false se ainda não estamos dentro da sala. */
  send(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.joined) return false;
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }

  /** Registra um ouvinte; devolve a função para cancelar o registro. */
  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  emit(type, payload) {
    for (const handler of this.listeners.get(type) || []) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[ws] erro no ouvinte de "${type}":`, err);
      }
    }
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close(1000, 'leave');
      this.socket = null;
    }
    this.joined = false;
  }
}

function defaultSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
