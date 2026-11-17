// Configuração lida das variáveis de ambiente (definidas no docker-compose.yml).
export const config = {
  port: Number(process.env.PORT || 3001),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://chess:chess@localhost:5432/wizardchess',
  // Intervalo do "ping" do WebSocket para detectar conexões mortas (ms)
  heartbeatMs: Number(process.env.WS_HEARTBEAT_MS || 30000),
  // Tempo que o servidor espera um jogador desconectado voltar (ex.: recarregou a
  // página) antes de encerrar a partida e liberar a vaga dele (ms)
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS || 5000)
};
