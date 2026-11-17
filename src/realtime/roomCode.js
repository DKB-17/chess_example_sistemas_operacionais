// Código da sala na URL: https://site/x9t2g  ->  "x9t2g"
// 5 caracteres, letras ou números (o servidor gera em minúsculas).
export const ROOM_CODE_REGEX = /^[a-z0-9]{5}$/;

/** Extrai o código da sala do caminho da URL (aceita "/x9t2g" e "/x9t2g/"). */
export function parseRoomCodeFromPath(pathname = window.location.pathname) {
  const match = /^\/([A-Za-z0-9]{5})\/?$/.exec(pathname || '');
  return match ? match[1].toLowerCase() : null;
}

export function roomPath(code) {
  return `/${code}`;
}

export function roomUrl(code) {
  return `${window.location.origin}${roomPath(code)}`;
}
