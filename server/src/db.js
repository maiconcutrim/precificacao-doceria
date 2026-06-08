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

  // garante as linhas únicas (singletons) de negócio e parâmetros
  db.prepare("INSERT OR IGNORE INTO business (id) VALUES (1)").run();
  db.prepare("INSERT OR IGNORE INTO parameters (id) VALUES (1)").run();

  return db;
}
