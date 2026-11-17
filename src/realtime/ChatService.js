/**
 * SERVIÇO DE TROCA DE MENSAGENS (chat) no navegador.
 *
 * Usa o GameSocketChannel apenas como transporte:
 *  - send(texto)   -> envia { type: 'chat', payload: { text } } pelo canal
 *  - ao receber 'joined' -> carrega o histórico da sala
 *  - ao receber 'chat'   -> adiciona a mensagem e avisa a interface (React)
 */
export class ChatService {
  static MAX_LENGTH = 500;

  constructor() {
    this.channel = null;
    this.messages = [];
    this.listeners = new Set();
    this.unsubscribers = [];
  }

  /** Liga o serviço a um canal (uma sala). */
  attach(channel) {
    this.detach();
    this.channel = channel;
    this.unsubscribers = [
      channel.on('joined', (payload) => this.setMessages(payload.chat || [])),
      channel.on('chat', (payload) => this.addMessage(payload.message))
    ];
  }

  detach() {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.channel = null;
    this.setMessages([]);
  }

  /** @returns {boolean} true se a mensagem foi enviada */
  send(text) {
    const clean = String(text || '').trim().slice(0, ChatService.MAX_LENGTH);
    if (!clean || !this.channel) return false;
    return this.channel.send('chat', { text: clean });
  }

  addMessage(message) {
    if (!message || this.messages.some((m) => m.id === message.id)) return;
    this.setMessages([...this.messages, message]);
  }

  setMessages(messages) {
    this.messages = messages; // nova referência a cada mudança (exigido pelo React)
    for (const listener of this.listeners) listener();
  }

  getMessages = () => this.messages;

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
