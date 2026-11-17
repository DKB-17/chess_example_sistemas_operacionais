import { useEffect, useState } from 'react';
import { onlineMatch } from '../realtime/OnlineMatch.js';
import { roomUrl } from '../realtime/roomCode.js';
import { useOnlineMatch } from '../realtime/useOnlineMatch';

const COLOR_NAME = { w: 'Brancas', b: 'Pretas' } as const;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para http sem contexto seguro (ex.: acesso pelo IP da rede)
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

/**
 * Painel da sala online: código/link, status dos jogadores e erros (sala cheia etc.).
 *
 * Quando a partida começa (2/2 conectados) o painel se recolhe sozinho num botão
 * pequeno, deixando a visão do tabuleiro limpa. Se o oponente sair, ele reabre,
 * porque o link volta a ser necessário para chamar outro jogador.
 */
export default function OnlineRoomPanel() {
  const state = useOnlineMatch();
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const ready = state.active && state.presence.ready;

  useEffect(() => {
    setCollapsed(ready);
  }, [ready]);

  if (state.error?.fatal || (state.error && !state.active)) {
    return (
      <div className="online-panel online-panel-error" role="alert">
        <div className="online-panel-title">Não foi possível entrar na partida</div>
        <div className="online-panel-status">{state.error.message}</div>
        <div className="online-panel-actions">
          <button type="button" className="hud-btn" onClick={() => onlineMatch.leave()}>
            Voltar ao jogo contra IA
          </button>
        </div>
      </div>
    );
  }

  if (state.connection === 'creating') {
    return (
      <div className="online-panel">
        <div className="online-panel-status">Criando sala...</div>
      </div>
    );
  }

  if (!state.active || !state.roomCode) return null;

  const link = roomUrl(state.roomCode);
  let status: string;
  let tone = 'waiting';
  if (state.connection === 'connecting') {
    status = 'Conectando ao servidor...';
  } else if (state.connection === 'reconnecting') {
    status = 'Conexão perdida — tentando reconectar...';
    tone = 'danger';
  } else if (!state.presence.ready) {
    status = 'Aguardando o outro jogador entrar pelo link. A partida começa quando os 2 estiverem conectados.';
  } else {
    status = `2/2 jogadores conectados • Você joga de ${state.color ? COLOR_NAME[state.color] : '...'}`;
    tone = 'ready';
  }

  if (collapsed) {
    return (
      <button
        type="button"
        id="btn-room-info"
        className="hud-btn online-pill"
        title="Mostrar informações da sala"
        aria-expanded="false"
        onClick={() => setCollapsed(false)}
      >
        <span className={`online-dot online-dot-${tone}`} aria-hidden="true"></span>
        Sala <span className="online-pill-code">{state.roomCode}</span>
      </button>
    );
  }

  return (
    <div className="online-panel" id="online-room-panel">
      <div className="online-panel-row">
        <span className="online-panel-label">Sala</span>
        <span className="online-room-code">{state.roomCode}</span>
        <span className={`online-dot online-dot-${tone}`} aria-hidden="true"></span>
        <button
          type="button"
          className="online-panel-hide"
          title="Ocultar e deixar o tabuleiro livre"
          aria-label="Ocultar painel da sala"
          aria-expanded="true"
          onClick={() => setCollapsed(true)}
        >
          ×
        </button>
      </div>
      {state.notice && (
        <div className="online-panel-notice" role="status">
          {state.notice} Uma nova partida começa quando outro jogador entrar pelo link.
        </div>
      )}
      <div className="online-panel-status">{status}</div>
      <div className="online-panel-actions">
        <button
          type="button"
          className="hud-btn"
          id="btn-copy-room-link"
          title={link}
          onClick={async () => {
            if (await copyText(link)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
        >
          {copied ? 'Link copiado!' : 'Copiar link'}
        </button>
        <button type="button" className="hud-btn" onClick={() => onlineMatch.leave()}>
          Sair da sala
        </button>
      </div>
      {state.error && !state.error.fatal && (
        <div className="online-panel-warning" onClick={() => onlineMatch.clearError()}>
          {state.error.message}
        </div>
      )}
    </div>
  );
}
