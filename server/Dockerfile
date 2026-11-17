# Servidor WebSocket (Node.js) — salas, chat e jogadas
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY db ./db
COPY src ./src

USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "src/index.js"]
