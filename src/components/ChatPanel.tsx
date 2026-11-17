import { FormEvent, useEffect, useRef, useState } from 'react';
import { onlineMatch } from '../realtime/OnlineMatch.js';
import { ChatService } from '../realtime/ChatService.js';
import { useChatMessages, useOnlineMatch } from '../realtime/useOnlineMatch';

function formatTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Chat da partida online (as mensagens trafegam pelo WebSocket via ChatService). */
export default function ChatPanel() {
  const state = useOnlineMatch();
  const messages = useChatMessages();
  const [open, setOpen] = useState(() => window.innerWidth > 768);
  const [draft, setDraft] = useState('');
  const [seenCount, setSeenCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Rola para a última mensagem e zera o contador de não lidas quando aberto
  useEffect(() => {
    if (!open) return;
    setSeenCount(messages.length);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  if (!state.active || !state.color) return null;

  const unread = Math.max(0, messages.length - seenCount);
  const canSend = state.connection === 'open';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (onlineMatch.chat.send(draft)) setDraft('');
  };

  if (!open) {
    return (
      <button type="button" className="hud-btn chat-toggle" id="btn-chat-open" onClick={() => setOpen(true)}>
        Chat{unread > 0 ? ` (${unread})` : ''}
      </button>
    );
  }

  return (
    <section className="chat-panel" aria-label="Chat da partida">
      <header className="chat-header">
        <span>Chat • Sala {state.roomCode}</span>
        <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Minimizar chat">
          —
        </button>
      </header>

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && <div className="chat-empty">Nenhuma mensagem ainda. Diga olá!</div>}
        {messages.map((m) => {
          const mine = m.color === state.color;
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'mine' : 'theirs'}`}>
              <div className="chat-meta">
                <span className={`chat-color-dot ${m.color === 'b' ? 'black' : 'white'}`}></span>
                {mine ? 'Você' : 'Oponente'} • {formatTime(m.createdAt)}
              </div>
              <div className="chat-text">{m.text}</div>
            </div>
          );
        })}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          id="chat-input"
          type="text"
          value={draft}
          maxLength={ChatService.MAX_LENGTH}
          placeholder={canSend ? 'Escreva uma mensagem...' : 'Sem conexão...'}
          disabled={!canSend}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="hud-btn" disabled={!canSend || !draft.trim()}>
          Enviar
        </button>
      </form>
    </section>
  );
}
