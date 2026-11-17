import http from 'node:http';
import { WebSocketServer } from 'ws';
import { ChannelManager } from './channel/ChannelManager.js';
import { ChatService } from './services/ChatService.js';
import { MatchService } from './services/MatchService.js';
import { isValidPlayerToken } from './rooms/roomCode.js';

/**
 * Monta o servidor HTTP + WebSocket. Recebe o repositório pronto para que os testes
 * possam usar a versão em memória e o index.js use a do PostgreSQL.
 *
 *   POST /api/rooms   -> cria sala, responde { code }
 *   GET  /api/health  -> verificação de saúde (usada pelo Docker)
 *   WS   /ws?room=CODE&token=TOKEN -> canal de tempo real da sala
 */
export function createApp({
  repository,
  heartbeatMs,
  disconnectGraceMs,
  healthCheck = async () => true
}) {
  const chatService = new ChatService({ repository });
  const matchService = new MatchService({ repository });
  const channelManager = new ChannelManager({
    repository,
    chatService,
    matchService,
    heartbeatMs,
    disconnectGraceMs
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/api/health') {
        const ok = await healthCheck().catch(() => false);
        return sendJson(res, ok ? 200 : 503, { ok });
      }

      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const body = await readJsonBody(req);
        if (!isValidPlayerToken(body?.token)) {
          return sendJson(res, 400, { error: 'Token de jogador inválido.' });
        }
        const code = await channelManager.createRoom(body.token);
        return sendJson(res, 201, { code });
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('[http] erro:', err);
      sendJson(res, 500, { error: 'Erro interno' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  channelManager.attach(wss);

  return { server, wss, channelManager };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body muito grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}
