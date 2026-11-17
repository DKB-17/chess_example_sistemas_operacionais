import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { InMemoryRoomRepository } from '../src/rooms/RoomRepository.js';
import { ROOM_CODE_REGEX } from '../src/rooms/roomCode.js';

async function startServer({ disconnectGraceMs = 5000 } = {}) {
  const app = createApp({
    repository: new InMemoryRoomRepository(),
    heartbeatMs: 60000,
    disconnectGraceMs
  });
  await new Promise((r) => app.server.listen(0, r));
  const { port } = app.server.address();
  return { ...app, base: `http://localhost:${port}`, wsBase: `ws://localhost:${port}/ws` };
}

async function stopServer(app) {
  for (const c of app.wss.clients) c.terminate();
  await new Promise((r) => app.wss.close(r));
  await new Promise((r) => app.server.close(r));
}

async function createRoom(app, token) {
  const res = await fetch(`${app.base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  assert.equal(res.status, 201);
  return (await res.json()).code;
}

/** Cliente de teste: guarda as mensagens recebidas e permite esperar por um tipo. */
function connect(app, code, token) {
  const ws = new WebSocket(`${app.wsBase}?room=${code}&token=${token}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const client = {
    ws,
    inbox,
    send: (type, payload) => ws.send(JSON.stringify({ type, payload })),
    next(type, predicate = () => true) {
      const match = (m) => m.type === type && predicate(m.payload);
      const found = inbox.find(match);
      if (found) {
        inbox.splice(inbox.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout esperando "${type}"`)), 2000);
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(timer);
            inbox.splice(inbox.indexOf(m), 1);
            resolve(m);
          }
        });
      });
    },
    closed: new Promise((r) => ws.on('close', (code) => r(code)))
  };
  return client;
}

test('código da sala tem 5 caracteres (letras/números)', async () => {
  const app = await startServer();
  try {
    const code = await createRoom(app, 'token-white-1');
    assert.match(code, ROOM_CODE_REGEX);
  } finally {
    await stopServer(app);
  }
});

test('sala comporta só 2 jogadores e a partida só começa com os dois conectados', async () => {
  const app = await startServer();
  try {
    const code = await createRoom(app, 'token-white-1');

    const white = connect(app, code, 'token-white-1');
    const joinedW = await white.next('joined');
    assert.equal(joinedW.payload.color, 'w');
    assert.equal(joinedW.payload.presence.ready, false);

    // Jogada antes do adversário entrar é recusada
    white.send('move', { seq: 1, from: { r: 6, c: 4 }, to: { r: 4, c: 4 } });
    const rejected = await white.next('move_rejected');
    assert.equal(rejected.payload.reason, 'OPPONENT_NOT_CONNECTED');

    const black = connect(app, code, 'token-black-1');
    const joinedB = await black.next('joined');
    assert.equal(joinedB.payload.color, 'b');
    await white.next('presence', (p) => p.ready === true);

    // Terceiro jogador é recusado
    const intruder = connect(app, code, 'token-intruder');
    const err = await intruder.next('error');
    assert.equal(err.payload.code, 'ROOM_FULL');
    assert.equal(await intruder.closed, 4403);

    // Jogada válida é retransmitida para os dois com seq
    white.send('move', { seq: 1, from: { r: 6, c: 4 }, to: { r: 4, c: 4 } });
    const mvB = await black.next('move');
    assert.equal(mvB.payload.move.seq, 1);
    assert.equal(mvB.payload.move.color, 'w');

    // Brancas não podem jogar duas vezes seguidas
    white.send('move', { seq: 2, from: { r: 6, c: 3 }, to: { r: 4, c: 3 } });
    assert.equal((await white.next('move_rejected')).payload.reason, 'NOT_YOUR_TURN');

    // Reconexão com o mesmo token recupera a cor e o histórico
    black.ws.close();
    await white.next('presence', (p) => p.b === false);
    const blackAgain = connect(app, code, 'token-black-1');
    const rejoined = await blackAgain.next('joined');
    assert.equal(rejoined.payload.color, 'b');
    assert.equal(rejoined.payload.moves.length, 1);

    for (const c of [white, blackAgain]) c.ws.close();
  } finally {
    await stopServer(app);
  }
});

test('chat é entregue aos dois jogadores e fica no histórico', async () => {
  const app = await startServer();
  try {
    const code = await createRoom(app, 'token-white-2');
    const white = connect(app, code, 'token-white-2');
    await white.next('joined');
    const black = connect(app, code, 'token-black-2');
    await black.next('joined');

    white.send('chat', { text: '  Boa sorte!  ' });
    const atBlack = await black.next('chat');
    const atWhite = await white.next('chat');
    assert.equal(atBlack.payload.message.text, 'Boa sorte!');
    assert.equal(atBlack.payload.message.color, 'w');
    assert.equal(atWhite.payload.message.id, atBlack.payload.message.id);

    black.ws.close();
    const blackAgain = connect(app, code, 'token-black-2');
    const rejoined = await blackAgain.next('joined');
    assert.equal(rejoined.payload.chat.length, 1);

    for (const c of [white, blackAgain]) c.ws.close();
  } finally {
    await stopServer(app);
  }
});

test('jogador que cai e não volta no prazo encerra a partida e libera a vaga', async () => {
  const app = await startServer({ disconnectGraceMs: 150 });
  try {
    const code = await createRoom(app, 'token-white-3');
    const white = connect(app, code, 'token-white-3');
    await white.next('joined');
    const black = connect(app, code, 'token-black-3');
    await black.next('joined');
    await white.next('presence', (p) => p.ready === true);

    white.send('move', { seq: 1, from: { r: 6, c: 4 }, to: { r: 4, c: 4 } });
    await black.next('move');

    // Pretas caem e não voltam: depois do prazo a partida acaba para as brancas
    black.ws.close();
    const ended = await white.next('match_ended');
    assert.equal(ended.payload.reason, 'PLAYER_DISCONNECTED');
    assert.equal(ended.payload.leftColor, 'b');
    assert.equal(ended.payload.presence.ready, false);

    // A vaga ficou livre: um novo jogador entra numa partida nova (sem jogadas)
    const newcomer = connect(app, code, 'token-newcomer-3');
    const joined = await newcomer.next('joined');
    assert.equal(joined.payload.color, 'b');
    assert.equal(joined.payload.moves.length, 0);
    assert.equal(joined.payload.presence.ready, true);

    for (const c of [white, newcomer]) c.ws.close();
  } finally {
    await stopServer(app);
  }
});

test('"Sair da sala" encerra a partida na hora; quem entra fica com a vaga livre', async () => {
  const app = await startServer({ disconnectGraceMs: 60000 });
  try {
    const code = await createRoom(app, 'token-white-4');
    const white = connect(app, code, 'token-white-4');
    await white.next('joined');
    const black = connect(app, code, 'token-black-4');
    await black.next('joined');

    // As brancas saem: as pretas são avisadas sem esperar o prazo de reconexão
    white.send('leave');
    const ended = await black.next('match_ended');
    assert.equal(ended.payload.reason, 'PLAYER_LEFT');
    assert.equal(ended.payload.leftColor, 'w');
    assert.equal(await white.closed, 1000);

    // Quem entra agora ocupa a vaga das brancas; as pretas continuam pretas
    const newcomer = connect(app, code, 'token-newcomer-4');
    assert.equal((await newcomer.next('joined')).payload.color, 'w');
    await black.next('presence', (p) => p.ready === true);

    for (const c of [black, newcomer]) c.ws.close();
  } finally {
    await stopServer(app);
  }
});

test('sala inexistente é recusada', async () => {
  const app = await startServer();
  try {
    const client = connect(app, 'zzzzz', 'token-any-1');
    assert.equal((await client.next('error')).payload.code, 'ROOM_NOT_FOUND');
    assert.equal(await client.closed, 4404);
  } finally {
    await stopServer(app);
  }
});
