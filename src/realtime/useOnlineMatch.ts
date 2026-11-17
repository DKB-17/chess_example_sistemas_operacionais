import { useSyncExternalStore } from 'react';
import { onlineMatch } from './OnlineMatch.js';

/** Estado da partida online (sala, cor, conexão, presença, erro) para componentes React. */
export function useOnlineMatch() {
  return useSyncExternalStore(onlineMatch.subscribe, onlineMatch.getState);
}

/** Mensagens do chat da sala atual. */
export function useChatMessages() {
  return useSyncExternalStore(onlineMatch.chat.subscribe, onlineMatch.chat.getMessages);
}
