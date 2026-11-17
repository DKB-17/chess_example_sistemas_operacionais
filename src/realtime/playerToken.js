const STORAGE_KEY = 'wizard_chess_player_token';

/**
 * Identidade do jogador: um token aleatório guardado no sessionStorage da ABA.
 * - Recarregar a página mantém o token -> o jogador reconecta no mesmo lugar (mesma cor).
 * - Outra aba/janela anônima gera outro token -> é tratada como outro jogador.
 */
export function getPlayerToken() {
  let token = null;
  try {
    token = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage bloqueado: segue com token só em memória */
  }
  if (!token) {
    token = randomToken();
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* ignore */
    }
  }
  return token;
}

function randomToken() {
  // crypto.randomUUID só existe em contexto seguro (https/localhost);
  // getRandomValues funciona também em http://IP-da-rede.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
