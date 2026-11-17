-- Esquema do banco do Wizard Chess.
-- Executado pelo servidor na inicialização (idempotente: só cria o que não existe).

-- Uma sala = uma partida jogador x jogador, identificada pelo código de 5 caracteres da URL.
-- Cada vaga guarda o token de quem a ocupa; NULL = vaga livre (o jogador saiu).
CREATE TABLE IF NOT EXISTS rooms (
  code         VARCHAR(5)  PRIMARY KEY,
  white_token  VARCHAR(64),                    -- quem criou a sala joga de brancas
  black_token  VARCHAR(64),                    -- preenchido quando o 2º jogador entra
  reset_count  INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bancos criados pela versão anterior tinham white_token NOT NULL; agora a vaga
-- das brancas também pode ficar livre quando esse jogador sai da partida.
ALTER TABLE rooms ALTER COLUMN white_token DROP NOT NULL;

-- Jogadas da partida em ordem (seq = 1, 2, 3...). O par (room_code, seq) é único:
-- o banco garante que duas jogadas nunca ocupem a mesma posição na sequência.
CREATE TABLE IF NOT EXISTS moves (
  id          BIGSERIAL   PRIMARY KEY,
  room_code   VARCHAR(5)  NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  seq         INTEGER     NOT NULL,
  color       CHAR(1)     NOT NULL CHECK (color IN ('w', 'b')),
  from_r      SMALLINT    NOT NULL,
  from_c      SMALLINT    NOT NULL,
  to_r        SMALLINT    NOT NULL,
  to_c        SMALLINT    NOT NULL,
  promotion   VARCHAR(8)  NOT NULL DEFAULT 'queen',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_code, seq)
);

-- Mensagens do chat da sala.
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL    PRIMARY KEY,
  room_code   VARCHAR(5)   NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  color       CHAR(1)      NOT NULL CHECK (color IN ('w', 'b')),
  text        VARCHAR(500) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_room_created ON chat_messages (room_code, created_at);
