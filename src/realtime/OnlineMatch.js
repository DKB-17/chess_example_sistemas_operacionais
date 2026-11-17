import { GameSocketChannel } from './GameSocketChannel.js';
import { ChatService } from './ChatService.js';
import { getPlayerToken } from './playerToken.js';
import { parseRoomCodeFromPath, roomPath } from './roomCode.js';

/**
 * @typedef {{ w: boolean, b: boolean, ready: boolean }} Presence
 * @typedef {{ code: string, message: string, fatal?: boolean }} OnlineError
 * @typedef {{
 *   active: boolean,
 *   roomCode: string | null,
 *   color: 'w' | 'b' | null,
 *   connection: 'idle' | 'creating' | 'connecting' | 'open' | 'reconnecting' | 'closed',
 *   presence: Presence,
 *   error: OnlineError | null,
 *   notice: string | null
 * }} OnlineState
 */

// Mensagens mostradas quando a partida é encerrada porque um jogador saiu
const MATCH_ENDED_NOTICE = {
  PLAYER_LEFT: 'O oponente saiu da sala. Partida encerrada.',
  PLAYER_DISCONNECTED: 'O oponente desconectou. Partida encerrada.'
};
const REJOINED_AFTER_END_NOTICE =
  'Você ficou desconectado por muito tempo e a partida anterior foi encerrada.';

/** @type {Presence} */
const NO_PRESENCE = { w: false, b: false, ready: false };

/** @type {OnlineState} */
const INITIAL_STATE = {
  active: false,
  roomCode: null,
  color: null,
  connection: 'idle',
  presence: NO_PRESENCE,
  error: null,
  notice: null
};

/**
 * Orquestra a partida online no navegador:
 *  - cria a sala (POST /api/rooms) e coloca o código na URL (/x9t2g)
 *  - abre o GameSocketChannel e liga o ChatService a ele
 *  - repassa os eventos do jogo (jogadas, reset, presença) para o motor 3D
 *  - expõe um "store" simples para a interface React (subscribe/getState)
 */
class OnlineMatch {
  constructor() {
    /** @type {OnlineState} */
    this.state = INITIAL_STATE;
    /** @type {GameSocketChannel | null} */
    this.channel = null;
    this.chat = new ChatService();
    this.stateListeners = new Set();
    this.eventListeners = new Map();
  }

  // ---- store para o React (useSyncExternalStore) ----
  getState = () => this.state;

  subscribe = (listener) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) listener();
  }

  // ---- eventos para o motor do jogo ----
  // 'joined' | 'sync' | 'move' | 'move_rejected' | 'reset' | 'match_ended' | 'presence' | 'left'
  on(event, handler) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event).add(handler);
    return () => this.eventListeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.eventListeners.get(event) || []) handler(payload);
  }

  // ---- ações ----
  async createRoom() {
    this.setState({ connection: 'creating', error: null });
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: getPlayerToken() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { code } = await res.json();
      window.history.pushState({}, '', roomPath(code));
      this.join(code);
      return code;
    } catch (err) {
      console.error('[online] falha ao criar sala:', err);
      this.setState({
        ...INITIAL_STATE,
        error: {
          code: 'CREATE_FAILED',
          message: 'Não foi possível criar a sala. O servidor do jogo está rodando?'
        }
      });
      return null;
    }
  }

  join(code) {
    this.disconnect();
    const channel = new GameSocketChannel({ roomCode: code, playerToken: getPlayerToken() });
    this.channel = channel;
    this.chat.attach(channel);
    this.setState({ ...INITIAL_STATE, active: true, roomCode: code, connection: 'connecting' });
    let lastResetCount = null; // para perceber, ao reconectar, que a partida foi encerrada

    channel.on('status', (connection) => {
      this.setState({ connection });
      if (connection !== 'open') this.updatePresence(NO_PRESENCE);
    });
    channel.on('joined', (payload) => {
      const endedWhileAway =
        lastResetCount !== null && payload.resetCount !== lastResetCount && !payload.moves?.length;
      lastResetCount = payload.resetCount;
      this.setState({
        color: payload.color,
        presence: payload.presence,
        error: null,
        notice: endedWhileAway ? REJOINED_AFTER_END_NOTICE : this.state.notice
      });
      this.emit('joined', payload);
    });
    channel.on('presence', (presence) => {
      // Um novo oponente entrou: o aviso da partida anterior não é mais necessário
      if (presence.ready && this.state.notice) this.setState({ notice: null });
      this.updatePresence(presence);
    });
    channel.on('match_ended', (payload) => {
      lastResetCount = payload.resetCount;
      this.setState({
        notice: MATCH_ENDED_NOTICE[payload.reason] || MATCH_ENDED_NOTICE.PLAYER_LEFT
      });
      this.updatePresence(payload.presence);
      this.emit('match_ended', payload);
    });
    channel.on('move', (payload) => this.emit('move', payload.move));
    channel.on('move_rejected', (payload) => this.emit('move_rejected', payload));
    channel.on('sync', (payload) => {
      this.setState({ presence: payload.presence });
      this.emit('sync', payload);
    });
    channel.on('reset', (payload) => {
      lastResetCount = payload.resetCount;
      this.emit('reset', payload);
    });
    channel.on('error', (payload) => {
      const fatal = Boolean(payload.fatal) || payload.code === 'SESSION_REPLACED';
      this.setState({ error: { ...payload, fatal } });
    });

    channel.connect();
  }

  updatePresence(presence) {
    const prev = this.state.presence;
    if (prev.w === presence.w && prev.b === presence.b && prev.ready === presence.ready) return;
    this.setState({ presence });
    this.emit('presence', presence);
  }

  /**
   * Sai da sala online e volta para o jogo local contra a IA.
   * Avisa o servidor ('leave') para encerrar a partida na hora — sem isso ele
   * esperaria o prazo de reconexão, achando que a internet caiu.
   */
  leave() {
    if (!this.state.active && !this.channel) {
      if (this.state.error) this.setState({ error: null });
      return;
    }
    this.channel?.send('leave');
    this.disconnect();
    this.setState(INITIAL_STATE);
    if (parseRoomCodeFromPath(window.location.pathname)) {
      window.history.pushState({}, '', '/');
    }
    this.emit('left');
  }

  disconnect() {
    if (!this.channel) return;
    this.channel.close();
    this.chat.detach();
    this.channel = null;
  }

  sendMove(move) {
    return this.channel?.send('move', move) ?? false;
  }

  requestReset() {
    return this.channel?.send('reset') ?? false;
  }

  requestSync() {
    return this.channel?.send('sync') ?? false;
  }

  clearError() {
    this.setState({ error: null });
  }

  clearNotice() {
    this.setState({ notice: null });
  }
}

export const onlineMatch = new OnlineMatch();
