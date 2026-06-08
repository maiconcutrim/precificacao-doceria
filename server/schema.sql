-- =============================================================================
--  Esquema do banco — Sistema de Precificação (SQLite, auto-hospedado)
-- =============================================================================
--  Modelo: uma instalação = uma doceria. Não há "conta" multi-tenant; o negócio
--  é representado por linhas únicas (singleton) em `business` e `parameters`.
--  Vários USUÁRIOS (dona + funcionárias) acessam a mesma instalação na rede local.
--
--  Convenções:
--   - Valores monetários, quantidades e percentuais são gravados como NÚMEROS
--     (REAL), já convertidos pela API a partir do que o usuário digita ("100,00"
--     -> 100.0). A formatação BR fica só na interface.
--   - Datas em TEXT no formato ISO (UTC), padrão datetime('now').
--   - Chaves estrangeiras precisam ser habilitadas a cada conexão (ver PRAGMA).
-- =============================================================================

PRAGMA foreign_keys = ON;     -- obrigatório: SQLite ignora FKs se desligado
PRAGMA journal_mode = WAL;    -- melhor concorrência (vários aparelhos na rede)

-- -----------------------------------------------------------------------------
--  Controle de versão do esquema (essencial para atualizar instalações distribuídas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- -----------------------------------------------------------------------------
--  Identidade do negócio (linha única)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business (
  id         INTEGER PRIMARY KEY CHECK (id = 1),   -- singleton
  name       TEXT    NOT NULL DEFAULT '',
  owner      TEXT    NOT NULL DEFAULT '',
  tagline    TEXT    NOT NULL DEFAULT '',
  phone      TEXT    NOT NULL DEFAULT '',
  instagram  TEXT    NOT NULL DEFAULT '',
  logo_path  TEXT,                                 -- caminho do arquivo no disco (não base64)
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
--  Usuários (login próprio)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,                  -- argon2/bcrypt (nunca texto puro)
  role          TEXT    NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('owner', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Sessões de login (alternativa a JWT; mantém o controle no servidor)
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,                     -- aleatório, opaco
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- -----------------------------------------------------------------------------
--  Parâmetros do negócio (linha única)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parameters (
  id               INTEGER PRIMARY KEY CHECK (id = 1),   -- singleton
  desired_earnings REAL    NOT NULL DEFAULT 0,
  hours_per_day    REAL    NOT NULL DEFAULT 0,
  days_per_week    REAL    NOT NULL DEFAULT 0,
  margin_pct       REAL    NOT NULL DEFAULT 40,
  rounding         TEXT    NOT NULL DEFAULT 'none'
                           CHECK (rounding IN ('none','0.10','0.50','1','0.90','0.99')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fixed_costs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL DEFAULT '',
  value      REAL    NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fees (            -- taxas de plataforma (iFood, cartão...)
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL DEFAULT '',
  pct        REAL    NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employees (       -- opcional: funcionárias que entram no custo/min
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL DEFAULT '',
  salary        REAL    NOT NULL DEFAULT 0,
  hours_per_day REAL    NOT NULL DEFAULT 0,
  days_per_week REAL    NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
--  Insumos: ingredientes e embalagens
--  active = 0 "esconde" o item sem apagá-lo (preserva histórico e vínculos).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL DEFAULT '',
  package_value REAL    NOT NULL DEFAULT 0,   -- valor da embalagem (R$)
  package_qty   REAL    NOT NULL DEFAULT 0,   -- quantidade na embalagem
  unit          TEXT    NOT NULL DEFAULT 'g'
                        CHECK (unit IN ('g','ml','un')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packaging (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL DEFAULT '',
  package_value REAL    NOT NULL DEFAULT 0,
  package_qty   REAL    NOT NULL DEFAULT 0,
  unit          TEXT    NOT NULL DEFAULT 'un'
                        CHECK (unit IN ('un','cm')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
--  Produtos e composição da receita
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL DEFAULT '',
  yield_qty    REAL    NOT NULL DEFAULT 0,   -- quantas unidades a receita rende
  minutes      REAL    NOT NULL DEFAULT 0,   -- tempo de produção da receita inteira
  sale_price   REAL,                         -- preço de venda informado (pode ser nulo)
  discount_pct REAL,                         -- desconto de revenda (pode ser nulo)
  status       TEXT    NOT NULL DEFAULT 'ativo'
                       CHECK (status IN ('ativo','inativo')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ingredientes de cada produto.
-- ON DELETE CASCADE: ao apagar o produto, suas linhas de receita somem.
-- ON DELETE RESTRICT no ingrediente: impede apagar um ingrediente em uso
-- (a interface deve "esconder" via active = 0 em vez de apagar).
CREATE TABLE IF NOT EXISTS product_ingredients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty           REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pi_product    ON product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_pi_ingredient ON product_ingredients(ingredient_id);

CREATE TABLE IF NOT EXISTS product_packaging (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  packaging_id INTEGER NOT NULL REFERENCES packaging(id) ON DELETE RESTRICT,
  qty          REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pp_product   ON product_packaging(product_id);
CREATE INDEX IF NOT EXISTS idx_pp_packaging ON product_packaging(packaging_id);

-- -----------------------------------------------------------------------------
--  Histórico de preços (somente inserção)
--  Cada vez que um preço é salvo, grava-se um instantâneo do resultado E das
--  entradas que o produziram (inputs_json), para o histórico continuar
--  verdadeiro mesmo que os custos dos ingredientes mudem depois.
--  Mantém product_name e fica com product_id nulo se o produto for apagado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name   TEXT    NOT NULL DEFAULT '',   -- snapshot do nome
  cost_per_unit  REAL    NOT NULL DEFAULT 0,
  suggested_unit REAL    NOT NULL DEFAULT 0,
  margin_pct     REAL    NOT NULL DEFAULT 0,    -- margem efetiva usada
  sale_price     REAL,
  inputs_json    TEXT    NOT NULL DEFAULT '{}', -- snapshot (ingredientes, custos, params, rounding)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ph_product ON price_history(product_id, created_at);
