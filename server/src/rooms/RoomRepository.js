/**
 * Persistência das salas, jogadas e mensagens de chat no PostgreSQL.
 *
 * Toda leitura/escrita no banco passa por aqui; o resto do servidor não conhece SQL.
 * Existe também uma versão em memória (InMemoryRoomRepository) com a mesma interface,
 * usada pelos testes automatizados.
 */
export class RoomRepository {
  /** @param {import('../db/Database.js').Database} db */
  constructor(db) {
    this.db = db;
  }

  /** Cria a sala. Retorna false se o código já existir (colisão). */
  async createRoom(code, whiteToken) {
    const res = await this.db.query(
      `INSERT INTO rooms (code, white_token) VALUES ($1, $2)
       ON CONFLICT (code) DO NOTHING`,
      [code, whiteToken]
    );
    return res.rowCount === 1;
  }

  async findRoom(code) {
    const res = await this.db.query(
      'SELECT code, white_token, black_token, reset_count FROM rooms WHERE code = $1',
      [code]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      code: row.code,
      whiteToken: row.white_token,
      blackToken: row.black_token,
      resetCount: row.reset_count
    };
  }

  /**
   * Ocupa uma vaga livre de forma ATÔMICA e devolve a cor ('w' | 'b') ou null.
   * Cada UPDATE só acontece se a vaga ainda estiver livre (IS NULL): se dois
   * jogadores tentarem entrar ao mesmo tempo, o banco deixa apenas um vencer —
   * é isso que garante o limite de 2 jogadores por sala.
   */
  async claimSeat(code, token) {
    for (const [color, column, other] of SEATS) {
      const res = await this.db.query(
        `UPDATE rooms SET ${column} = $2, updated_at = NOW()
         WHERE code = $1 AND ${column} IS NULL AND ${other} IS DISTINCT FROM $2`,
        [code, token]
      );
      if (res.rowCount === 1) return color;
    }
    return null;
  }

  /** Libera a vaga de quem saiu, para outro jogador poder entrar pelo mesmo link. */
  async releaseSeat(code, color) {
    const column = color === 'w' ? 'white_token' : 'black_token';
    await this.db.query(`UPDATE rooms SET ${column} = NULL, updated_at = NOW() WHERE code = $1`, [
      code
    ]);
  }

  async listMoves(code) {
    const res = await this.db.query(
      `SELECT seq, color, from_r, from_c, to_r, to_c, promotion
       FROM moves WHERE room_code = $1 ORDER BY seq`,
      [code]
    );
    return res.rows.map((row) => ({
      seq: row.seq,
      color: row.color,
      from: { r: row.from_r, c: row.from_c },
      to: { r: row.to_r, c: row.to_c },
      promotion: row.promotion
    }));
  }

  async appendMove(code, move) {
    await this.db.query(
      `INSERT INTO moves (room_code, seq, color, from_r, from_c, to_r, to_c, promotion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [code, move.seq, move.color, move.from.r, move.from.c, move.to.r, move.to.c, move.promotion]
    );
    await this.db.query('UPDATE rooms SET updated_at = NOW() WHERE code = $1', [code]);
  }

  /** Apaga as jogadas (nova partida na mesma sala) e devolve o novo resetCount. */
  async resetRoom(code) {
    await this.db.query('DELETE FROM moves WHERE room_code = $1', [code]);
    const res = await this.db.query(
      `UPDATE rooms SET reset_count = reset_count + 1, updated_at = NOW()
       WHERE code = $1 RETURNING reset_count`,
      [code]
    );
    return res.rows[0]?.reset_count ?? 0;
  }

  async saveChatMessage(code, color, text) {
    const res = await this.db.query(
      `INSERT INTO chat_messages (room_code, color, text) VALUES ($1, $2, $3)
       RETURNING id, color, text, created_at`,
      [code, color, text]
    );
    return toChatMessage(res.rows[0]);
  }

  async listChatMessages(code, limit = 50) {
    const res = await this.db.query(
      `SELECT id, color, text, created_at FROM (
         SELECT * FROM chat_messages WHERE room_code = $1 ORDER BY created_at DESC, id DESC LIMIT $2
       ) recent ORDER BY created_at, id`,
      [code, limit]
    );
    return res.rows.map(toChatMessage);
  }
}

// Ordem em que as vagas livres são ocupadas: sala vazia -> brancas primeiro.
// (Nomes de coluna fixos, nunca vindos do usuário.)
const SEATS = [
  ['w', 'white_token', 'black_token'],
  ['b', 'black_token', 'white_token']
];

function toChatMessage(row) {
  return {
    id: String(row.id),
    color: row.color,
    text: row.text,
    createdAt: new Date(row.created_at).toISOString()
  };
}

/** Mesma interface do RoomRepository, guardando tudo em memória (usado nos testes). */
export class InMemoryRoomRepository {
  constructor() {
    this.rooms = new Map();
    this.nextChatId = 1;
  }

  async createRoom(code, whiteToken) {
    if (this.rooms.has(code)) return false;
    this.rooms.set(code, { code, whiteToken, blackToken: null, resetCount: 0, moves: [], chat: [] });
    return true;
  }

  async findRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const { whiteToken, blackToken, resetCount } = room;
    return { code, whiteToken, blackToken, resetCount };
  }

  async claimSeat(code, token) {
    const room = this.rooms.get(code);
    if (!room) return null;
    if (!room.whiteToken && room.blackToken !== token) {
      room.whiteToken = token;
      return 'w';
    }
    if (!room.blackToken && room.whiteToken !== token) {
      room.blackToken = token;
      return 'b';
    }
    return null;
  }

  async releaseSeat(code, color) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (color === 'w') room.whiteToken = null;
    else room.blackToken = null;
  }

  async listMoves(code) {
    return [...(this.rooms.get(code)?.moves || [])];
  }

  async appendMove(code, move) {
    const room = this.rooms.get(code);
    if (room.moves.some((m) => m.seq === move.seq)) throw new Error('duplicate seq');
    room.moves.push(move);
  }

  async resetRoom(code) {
    const room = this.rooms.get(code);
    room.moves = [];
    room.resetCount += 1;
    return room.resetCount;
  }

  async saveChatMessage(code, color, text) {
    const msg = { id: String(this.nextChatId++), color, text, createdAt: new Date().toISOString() };
    this.rooms.get(code).chat.push(msg);
    return msg;
  }

  async listChatMessages(code, limit = 50) {
    return (this.rooms.get(code)?.chat || []).slice(-limit);
  }
}
