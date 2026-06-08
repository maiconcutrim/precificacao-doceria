-- =============================================================================
--  Esquema do banco — Sistema de Precificação (SQLite, auto-hospedado)
-- =============================================================================
--  Modelo: uma instalação = uma doceria. Não há "conta" multi-tenant; o negócio
--  é representado por linhas únicas (singleton) em `business` e `parameters`.
--  Vários USUÁRIOS (dona + funcionárias) acessam a mesma instalação na rede local.
--
--  Identificadores:
--   - Entidades gerenciadas pelo app (ingredientes, embalagens, produtos, custos
--     fixos, taxas, funcionários e os vínculos de receita) usam id TEXT gerado pelo
--     próprio app — o servidor faz upsert por id. Isso mantém estáveis as referências
--     dos produtos e as chaves da interface, e facilita sincronização/offline.
--   - Usuários, sessões e histórico de preços usam ids gerados pelo servidor.
--
--  Convenções:
--   - Monetários, quantidades e percentuais são gravados como NÚMEROS (REAL),
--     convertidos pela API a partir do que o usuário digita ("100,00" -> 100.0).
--   - Datas em TEXT no formato ISO (UTC), padrão datetime('now').
--   - Chaves estrangeiras precisam ser habilitadas a cada conexão (ver PRAGMA).
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Controle de versão do esquema (para atualizar instalações distribuídas)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- Identidade do negócio (linha única)
CREATE TABLE IF NOT EXISTS business (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  name       TEXT    NOT NULL DEFAULT '',
  owner      TEXT    NOT NULL DEFAULT '',
  tagline    TEXT    NOT NULL DEFAULT '',
  phone      TEXT    NOT NULL DEFAULT '',
  instagram  TEXT    NOT NULL DEFAULT '',
  logo_path  TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Usuários (login próprio) — id gerado pelo servidor
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Parâmetros do negócio (linha única)
CREATE TABLE IF NOT EXISTS parameters (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  desired_earnings REAL    NOT NULL DEFAULT 0,
  hours_per_day    REAL    NOT NULL DEFAULT 0,
  days_per_week    REAL    NOT NULL DEFAULT 0,
  margin_pct       REAL    NOT NULL DEFAULT 40,
  rounding         TEXT    NOT NULL DEFAULT 'none'
                           CHECK (rounding IN ('none','0.10','0.50','1','0.90','0.99')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Listas gerenciadas pelo app (id TEXT do cliente)
CREATE TABLE IF NOT EXISTS fixed_costs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  value      REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fees (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  pct        REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  salary        REAL NOT NULL DEFAULT 0,
  hours_per_day REAL NOT NULL DEFAULT 0,
  days_per_week REAL NOT NULL DEFAULT 0
);

-- Insumos (active = 0 "esconde" sem apagar)
CREATE TABLE IF NOT EXISTS ingredients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  package_value REAL NOT NULL DEFAULT 0,
  package_qty   REAL NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT 'g' CHECK (unit IN ('g','ml','un')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packaging (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  package_value REAL NOT NULL DEFAULT 0,
  package_qty   REAL NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT 'un' CHECK (unit IN ('un','cm')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Produtos e composição da receita
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  yield_qty    REAL NOT NULL DEFAULT 0,
  minutes      REAL NOT NULL DEFAULT 0,
  sale_price   REAL,
  discount_pct REAL,
  status       TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ON DELETE CASCADE: apagar o produto remove suas linhas de receita.
-- ON DELETE RESTRICT no insumo: impede apagar ingrediente/embalagem em uso.
CREATE TABLE IF NOT EXISTS product_ingredients (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty           REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pi_product    ON product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_pi_ingredient ON product_ingredients(ingredient_id);

CREATE TABLE IF NOT EXISTS product_packaging (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  packaging_id TEXT NOT NULL REFERENCES packaging(id) ON DELETE RESTRICT,
  qty          REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pp_product   ON product_packaging(product_id);
CREATE INDEX IF NOT EXISTS idx_pp_packaging ON product_packaging(packaging_id);

-- Histórico de preços (somente inserção)
CREATE TABLE IF NOT EXISTS price_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL DEFAULT '',
  cost_per_unit  REAL NOT NULL DEFAULT 0,
  suggested_unit REAL NOT NULL DEFAULT 0,
  margin_pct     REAL NOT NULL DEFAULT 0,
  sale_price     REAL,
  inputs_json    TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ph_product ON price_history(product_id, created_at);
