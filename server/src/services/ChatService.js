/**
 * SERVIÇO DE TROCA DE MENSAGENS (chat) entre os jogadores de uma sala.
 *
 * Fluxo de uma mensagem:
 *   jogador -> WebSocket -> ChannelManager.route -> ChatService.handleIncoming
 *     1. limpa/valida o texto
 *     2. aplica limite de envio (anti-flood)
 *     3. salva no banco
 *     4. transmite pelo CommunicationChannel para os dois jogadores
 */
export class ChatService {
  static MAX_LENGTH = 500;
  static HISTORY_SIZE = 50;

  constructor({ repository, rateLimit = { windowMs: 10000, max: 10 } }) {
    this.repository = repository;
    this.rateLimit = rateLimit;
    /** @type {Map<string, number[]>} horários dos últimos envios por jogador */
    this.sentAt = new Map();
  }

  /** Últimas mensagens da sala (enviadas a quem entra/reconecta). */
  history(roomCode) {
    return this.repository.listChatMessages(roomCode, ChatService.HISTORY_SIZE);
  }

  sanitize(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '') // remove caracteres de controle
      .trim()
      .slice(0, ChatService.MAX_LENGTH);
  }

  isRateLimited(key, now = Date.now()) {
    const { windowMs, max } = this.rateLimit;
    const recent = (this.sentAt.get(key) || []).filter((t) => now - t < windowMs);
    const limited = recent.length >= max;
    if (!limited) recent.push(now);
    this.sentAt.set(key, recent);
    return limited;
  }

  /**
   * @param {import('../channel/CommunicationChannel.js').CommunicationChannel} channel
   * @param {'w'|'b'} color quem enviou
   */
  async handleIncoming(channel, color, payload) {
    const text = this.sanitize(payload?.text);
    if (!text) return;

    if (this.isRateLimited(`${channel.code}:${color}`)) {
      channel.send(color, 'error', {
        code: 'CHAT_RATE_LIMIT',
        message: 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.'
      });
      return;
    }

    const message = await this.repository.saveChatMessage(channel.code, color, text);
    channel.broadcast('chat', { message });
  }
}
