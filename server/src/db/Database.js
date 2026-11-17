import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '../../db/schema.sql');

/**
 * Acesso ao PostgreSQL (pool de conexões).
 *
 * Em ambiente Docker o banco pode demorar alguns segundos para aceitar conexões,
 * por isso `connectWithRetry` tenta várias vezes antes de desistir.
 */
export class Database {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async connectWithRetry({ retries = 30, delayMs = 2000 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.pool.query('SELECT 1');
        return;
      } catch (err) {
        console.log(`[db] aguardando PostgreSQL (tentativa ${attempt}/${retries}): ${err.message}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error('Não foi possível conectar ao PostgreSQL');
  }

  async migrate() {
    const sql = await fs.readFile(SCHEMA_PATH, 'utf-8');
    await this.pool.query(sql);
  }

  query(text, params) {
    return this.pool.query(text, params);
  }

  close() {
    return this.pool.end();
  }
}
