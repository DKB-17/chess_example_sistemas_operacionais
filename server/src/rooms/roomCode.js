import { randomInt } from 'node:crypto';

// Código da sala: 5 caracteres, letras minúsculas ou números (ex.: "x9t2g").
// 36^5 ≈ 60 milhões de combinações.
export const ROOM_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_REGEX = /^[a-z0-9]{5}$/;

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return ROOM_CODE_REGEX.test(code) ? code : null;
}

// Token do jogador: gerado no navegador (crypto.randomUUID) e guardado na aba.
export const PLAYER_TOKEN_REGEX = /^[A-Za-z0-9-]{8,64}$/;

export function isValidPlayerToken(value) {
  return typeof value === 'string' && PLAYER_TOKEN_REGEX.test(value);
}
