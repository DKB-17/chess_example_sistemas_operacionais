import { config } from './config.js';
import { Database } from './db/Database.js';
import { RoomRepository } from './rooms/RoomRepository.js';
import { createApp } from './app.js';

const db = new Database(config.databaseUrl);
await db.connectWithRetry();
await db.migrate();
console.log('[db] conectado e esquema aplicado');

const { server, wss } = createApp({
  repository: new RoomRepository(db),
  heartbeatMs: config.heartbeatMs,
  disconnectGraceMs: config.disconnectGraceMs,
  healthCheck: async () => {
    await db.query('SELECT 1');
    return true;
  }
});

server.listen(config.port, () => {
  console.log(`[server] HTTP + WebSocket ouvindo na porta ${config.port}`);
});

// Encerramento limpo quando o Docker para o container (SIGTERM)
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[server] ${signal} recebido, encerrando...`);
    for (const client of wss.clients) client.close(1001, 'server shutdown');
    wss.close();
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
