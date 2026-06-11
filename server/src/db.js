import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Abre (ou cria) o banco SQLite e garante que o esquema está aplicado.
 * O caminho do arquivo vem de DB_PATH; por padrão fica em ./data/doceria.db.
 * No app de desktop, esse caminho será a pasta de dados do usuário no Windows.
 */
export function openDatabase(dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "doceria.db")) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // aplica o esquema (idempotente — usa CREATE TABLE IF NOT EXISTS)
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  db.exec(schema);

  // migrações de bancos já existentes
  migrate(db);

  // garante as linhas únicas (singletons) de negócio e parâmetros
  db.prepare("INSERT OR IGNORE INTO business (id) VALUES (1)").run();
  db.prepare("INSERT OR IGNORE INTO parameters (id) VALUES (1)").run();

  return db;
}

/**
 * Migrações idempotentes guiadas por meta.schema_version.
 * v2: papéis de usuário passam de owner/staff para view/edit/admin.
 *     Como a tabela antiga tinha CHECK (owner/staff), é preciso reconstruí-la.
 */
function migrate(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  const version = row ? parseInt(row.value, 10) || 1 : 1;

  if (version < 2) {
    const hasOldRoles = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE role IN ('owner','staff')")
      .get().c > 0;
    if (hasOldRoles) {
      db.pragma("foreign_keys = OFF");
      const run = db.transaction(() => {
        db.exec(`
          CREATE TABLE users_mig (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            display_name  TEXT    NOT NULL DEFAULT '',
            password_hash TEXT    NOT NULL,
            role          TEXT    NOT NULL DEFAULT 'view' CHECK (role IN ('view','edit','admin')),
            active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            last_login_at TEXT
          );
          INSERT INTO users_mig (id,username,display_name,password_hash,role,active,created_at,last_login_at)
            SELECT id, username, display_name, password_hash,
              CASE role
                WHEN 'owner' THEN 'admin'
                WHEN 'staff' THEN 'edit'
                WHEN 'admin' THEN 'admin'
                WHEN 'edit'  THEN 'edit'
                WHEN 'view'  THEN 'view'
                ELSE 'view'
              END,
              active, created_at, last_login_at
            FROM users;
          DROP TABLE users;
          ALTER TABLE users_mig RENAME TO users;
        `);
      });
      run();
      db.pragma("foreign_keys = ON");
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
  }
}
