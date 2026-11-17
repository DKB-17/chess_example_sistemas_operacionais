# Wizard Chess — Computação Distribuída

Xadrez 3D (React + Three.js) com partidas **jogador x jogador em tempo real via WebSocket**,
**chat** entre os jogadores, **salas com código na URL** e tudo rodando em **Docker**
(banco, servidor e front-end).

## Como rodar

Requisito: Docker Desktop.

```bash
docker compose up -d --build
```

Abra http://localhost:8080. Para parar: `docker compose down` (os dados do banco ficam no volume
`pgdata`; `docker compose down -v` apaga tudo).

### Testando uma partida online

1. Clique em **Jogar Online** → a URL vira algo como `http://localhost:8080/x9t2g`.
2. Abra **outra janela anônima** (ou outro navegador/computador) e cole o mesmo link.
3. A partida começa quando os 2 estiverem conectados. Uma 3ª pessoa recebe "sala cheia".

> Cada **aba** é um jogador (o token fica no `sessionStorage`). Recarregar a página mantém o lugar;
> uma janela anônima nova é outro jogador. Para jogar de outro computador da rede, use
> `http://IP-DO-SEU-PC:8080/codigo`.

### Desenvolvimento sem Docker (opcional)

```bash
docker compose up -d db                                   # só o banco
cd server && npm install && npm start                     # servidor na porta 3001
npm install && npm run dev                                # front em http://localhost:3000 (proxy para /api e /ws)
```

Testes: `node --test test/*.mjs` (front) e `cd server && npm test` (servidor, usa banco em memória).

---

## Arquitetura

```
 Navegador A ─┐                         ┌──────────── container "server" (Node.js) ────────────┐
              │  HTTP  /  e  /assets    │                                                       │
              ├──────> web (nginx :80)  │  POST /api/rooms ──> ChannelManager.createRoom        │
              │        │                │                                                       │
              │  WS /ws?room=x9t2g      │  WebSocket ──> ChannelManager (cria/acha o canal)     │
 Navegador B ─┘        └── proxy ─────> │                   │                                   │
                                        │          CommunicationChannel (A <-> B)               │
                                        │             │                 │                       │
                                        │        ChatService       MatchService                 │
                                        │             └──── RoomRepository ────┘                │
                                        └─────────────────────────│─────────────────────────────┘
                                                                  │ SQL
                                                        container "db" (PostgreSQL)
```

| Container | Imagem | Papel |
|-----------|--------|-------|
| `web`     | `nginx` (build do `Dockerfile` da raiz) | Serve o front-end e faz **proxy reverso** de `/api` e `/ws` para o servidor |
| `server`  | `node:22` (build de `server/Dockerfile`) | Salas, WebSocket, chat e ordem das jogadas |
| `db`      | `postgres:16` | Persiste salas, jogadas e mensagens |

O navegador só conhece **uma** origem (`localhost:8080`); o nginx encaminha internamente
para os outros containers pela rede do Docker (nomes `server` e `db` viram endereços).

---

## 1. WebSocket e chat

HTTP é pedido → resposta: o servidor não consegue "avisar" o navegador. O **WebSocket** abre uma
conexão TCP que fica aberta e **bidirecional**: qualquer lado envia mensagens a qualquer momento.
É isso que permite a jogada e a mensagem do chat aparecerem na hora para o outro jogador.

Todas as mensagens seguem o formato `{ "type": "...", "payload": { ... } }`.

| Direção | `type` | Para quê |
|---------|--------|----------|
| cliente → servidor | `chat` | enviar mensagem `{ text }` |
| cliente → servidor | `move` | jogada `{ seq, from, to }` |
| cliente → servidor | `reset` / `sync` | nova partida / pedir estado completo |
| cliente → servidor | `leave` | "Sair da sala": encerra a partida na hora |
| servidor → cliente | `joined` | entrou: cor, jogadas, histórico do chat |
| servidor → cliente | `presence` | quem está conectado (`ready` = os 2) |
| servidor → clientes | `chat` / `move` / `reset` | retransmissão para os dois |
| servidor → cliente | `match_ended` | um jogador saiu: partida encerrada (`reason`, `leftColor`) |
| servidor → cliente | `move_rejected` + `sync` | jogada recusada + estado oficial |
| servidor → cliente | `error` | `ROOM_FULL`, `ROOM_NOT_FOUND`, ... |

### As duas classes pedidas (existem nos dois lados)

| Responsabilidade | Servidor | Navegador |
|------------------|----------|-----------|
| **Serviço de troca de mensagens** | [server/src/services/ChatService.js](server/src/services/ChatService.js) — valida, limita flood, salva no banco e transmite | [src/realtime/ChatService.js](src/realtime/ChatService.js) — envia texto, guarda a lista e avisa a interface |
| **Criação do canal de comunicação entre os dois** | [server/src/channel/ChannelManager.js](server/src/channel/ChannelManager.js) cria o [CommunicationChannel](server/src/channel/CommunicationChannel.js) da sala (o "fio" com o socket de cada jogador) | [src/realtime/GameSocketChannel.js](src/realtime/GameSocketChannel.js) — abre o WebSocket e reconecta sozinho |

O `ChatService` **não sabe** o que é WebSocket: ele só chama `channel.broadcast('chat', ...)`.
O canal **não sabe** o que é chat: só transporta mensagens. Essa separação é a premissa pedida.

Caminho de uma mensagem: `ChatPanel.tsx` → `ChatService.send` → `GameSocketChannel.send` →
nginx → `ChannelManager.route` → `ChatService.handleIncoming` → `RoomRepository.saveChatMessage`
→ `CommunicationChannel.broadcast` → os dois navegadores → `ChatPanel` re-renderiza.

## 2. Salas com código na URL

- **Jogar Online** faz `POST /api/rooms`; o servidor gera um código de **5 caracteres (a-z, 0-9)**
  ([roomCode.js](server/src/rooms/roomCode.js)) e quem criou fica com as **brancas**.
- O front muda a URL para `/x9t2g` (`history.pushState`) e conecta em `/ws?room=x9t2g&token=...`.
- Quem abre `/x9t2g` entra direto naquela sala. O nginx devolve o `index.html` para qualquer
  caminho (SPA) e o front lê o código de `location.pathname`.

**Máximo de 2 jogadores** — garantido no banco, de forma atômica
([RoomRepository.claimSeat](server/src/rooms/RoomRepository.js)):

```sql
UPDATE rooms SET black_token = $2 WHERE code = $1 AND black_token IS NULL
```

Se dois tentarem entrar no mesmo instante, só um `UPDATE` afeta a linha; o outro recebe
`ROOM_FULL` e a conexão é fechada com o código 4403.

**Só começa com 2 conectados** — o `CommunicationChannel.isReady()` exige os dois sockets abertos;
o `MatchService` recusa jogadas com `OPPONENT_NOT_CONNECTED` e o tabuleiro fica bloqueado com
"Aguardando oponente...".

**Jogador saiu = partida encerrada** — se sobrar só um jogador, a partida acaba
([MatchService.endMatch](server/src/services/MatchService.js)):

1. **Clicou em "Sair da sala"** → o navegador envia `leave` e o servidor encerra na hora.
2. **Fechou a aba / caiu a internet** → o servidor espera **5 segundos**
   (`DISCONNECT_GRACE_MS`) para ele voltar. Recarregar a página (F5) leva ~1 s e **não**
   encerra a partida; se não voltar no prazo, encerra.

Ao encerrar, o servidor **libera a vaga** de quem saiu (`releaseSeat`), apaga as jogadas
(nova partida) e envia `match_ended` para quem ficou: o tabuleiro volta ao início, aparece o
aviso "O oponente saiu... Partida encerrada" e o painel da sala reabre com o link. Quem entrar
pelo mesmo link ocupa a vaga livre e a **próxima partida começa**. Tudo isso roda na fila da sala
(`runExclusive`), então uma reconexão que chega junto com o fim do prazo não gera conflito.

**Painel da sala** — quando os 2 se conectam, o painel com o link se recolhe sozinho num botão
pequeno ("● Sala x9t2g"), deixando a visão do tabuleiro limpa; clique nele para reabrir
(copiar link / sair). O "×" no painel também o recolhe.

### Conceitos de sistemas distribuídos aplicados

- **Ordem total das jogadas:** o servidor numera cada jogada (`seq`) e processa uma por vez por
  sala (`CommunicationChannel.runExclusive`, uma fila de promessas) — sem condição de corrida.
- **Controle de concorrência otimista:** o cliente aplica sua jogada na hora e envia o `seq` que
  espera; se o servidor discordar (`OUT_OF_SYNC`, `NOT_YOUR_TURN`), devolve o estado oficial (`sync`)
  e o cliente se corrige.
- **Tolerância a falhas:** heartbeat (ping/pong a cada 30 s) detecta conexões mortas; o cliente
  reconecta com *backoff* exponencial (1 s, 2 s, 4 s... até 10 s); o estado está no PostgreSQL,
  então reiniciar o container `server` não perde a partida (`docker compose restart server`).
- **Detecção de saída com prazo de tolerância:** numa rede não dá para distinguir na hora
  "o jogador saiu" de "a conexão piscou". Por isso o servidor espera um prazo curto antes de
  declarar a saída, e o botão "Sair da sala" avisa explicitamente (`leave`) para não esperar.
- **Identidade sem login:** token aleatório por aba; reconectar com o mesmo token devolve a mesma cor.

## 3. Docker

- [`Dockerfile`](Dockerfile) (raiz): *multi-stage* — compila o front com Node e serve com nginx.
- [`server/Dockerfile`](server/Dockerfile): servidor Node com `HEALTHCHECK` em `/api/health`.
- [`docker-compose.yml`](docker-compose.yml): sobe `db` → `server` → `web` nessa ordem, cada um
  esperando o anterior ficar **saudável** (`depends_on: condition: service_healthy`).
- [`server/db/schema.sql`](server/db/schema.sql): tabelas `rooms`, `moves`, `chat_messages`,
  criadas pelo servidor ao iniciar.
- Configurações por variável de ambiente (`.env.example`): porta, usuário e senha do banco.

## 4. Visão 2D e ícones das peças

- Botão **Visão 2D** (em *Camera Views*): câmera exatamente em cima do tabuleiro, com altura
  calculada para caber na tela; clicar de novo inverte o lado (Brancas/Pretas embaixo).
- Cada peça tem um selo com o símbolo no chão, embaixo dela. Na Visão 2D os selos são desenhados
  por cima dos modelos 3D, como num tabuleiro comum. Código: [src/pieceIcons.js](src/pieceIcons.js).
- Os ícones ficam em `public/assets/piece-icons/<white|black>/<peça>.svg`. Para trocar, substitua
  o arquivo **mantendo o nome** — ver [LEIA-ME dos ícones](public/assets/piece-icons/LEIA-ME.md).

## Mapa dos arquivos novos

```
docker-compose.yml, .env.example, nginx.conf (proxy /api e /ws)
server/
  Dockerfile, package.json, db/schema.sql
  src/index.js                     inicia banco + servidor
  src/app.js                       rotas HTTP + WebSocketServer
  src/channel/ChannelManager.js    cria salas/canais, aceita/recusa conexões
  src/channel/CommunicationChannel.js  canal entre os 2 jogadores
  src/services/ChatService.js      chat
  src/services/MatchService.js     jogadas
  src/rooms/RoomRepository.js      SQL (e versão em memória para testes)
  test/rooms.test.js
src/
  realtime/GameSocketChannel.js    WebSocket do navegador
  realtime/ChatService.js          chat do navegador
  realtime/OnlineMatch.js          orquestra sala + canal + chat + eventos para o motor
  realtime/roomCode.js, playerToken.js, useOnlineMatch.ts
  components/OnlineRoomPanel.tsx   painel da sala (código, link, status, erros)
  components/ChatPanel.tsx         chat
  pieceIcons.js                    selos das peças
public/assets/piece-icons/         ícones (troque à vontade)
```

## Limitações conhecidas

- As regras do xadrez são validadas no navegador; o servidor valida formato, vez e ordem.
  Um cliente modificado poderia enviar uma jogada ilegal.
- "New Game" numa partida online reinicia para os dois, sem pedir confirmação ao oponente.
- Promoção de peão é sempre para rainha (comportamento original do jogo).
