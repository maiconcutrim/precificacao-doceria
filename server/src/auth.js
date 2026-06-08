import crypto from "node:crypto";

/* Hash de senha com scrypt (embutido no Node — sem dependência nativa). */
const SCRYPT_KEYLEN = 64;
const SESSION_TTL = "+30 days";
export const MIN_PASSWORD = 6;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(":")) return false;
  const [salt, hash] = String(stored).split(":");
  let test;
  try {
    test = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
  } catch {
    return false;
  }
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}

/* Middlewares de proteção. */
export function makeAuth(db) {
  const findSession = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `);

  function requireAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Não autenticado." });
    const u = findSession.get(token);
    if (!u || !u.active) return res.status(401).json({ error: "Sessão inválida ou expirada." });
    req.user = { id: u.id, username: u.username, displayName: u.display_name, role: u.role };
    req.token = token;
    next();
  }

  function requireOwner(req, res, next) {
    if (!req.user || req.user.role !== "owner")
      return res.status(403).json({ error: "Apenas a dona pode fazer isso." });
    next();
  }

  return { requireAuth, requireOwner };
}

/* Rotas de autenticação e gestão de usuários. */
export function registerAuthRoutes(app, db, auth) {
  const countUsers = db.prepare("SELECT COUNT(*) AS c FROM users");
  const findByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
  const insertUser = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)"
  );
  const createSession = db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  );
  const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
  const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  const touchLogin = db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?");
  const listUsers = db.prepare("SELECT id, username, display_name, role, active FROM users ORDER BY id");

  const startSession = (userId) => {
    const token = newToken();
    createSession.run(token, userId, SESSION_TTL);
    return token;
  };
  const publicUser = (u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
  });

  function validateCredentials(body) {
    const username = normalizeUsername(body?.username);
    const password = String(body?.password || "");
    if (!username) return { error: "Informe um nome de usuário." };
    if (password.length < MIN_PASSWORD)
      return { error: `A senha precisa de ao menos ${MIN_PASSWORD} caracteres.` };
    const displayName = String(body?.displayName || "").trim() || username;
    return { username, password, displayName };
  }

  // A interface usa isto ao abrir para decidir entre "criar conta" e "entrar".
  app.get("/auth/status", (_req, res) => {
    res.json({ needsSetup: countUsers.get().c === 0 });
  });

  // Primeiro acesso: cria a conta da DONA (somente enquanto não houver usuários).
  app.post("/auth/register", (req, res) => {
    if (countUsers.get().c > 0)
      return res.status(403).json({ error: "Já existe uma conta. Peça à dona para criar seu usuário." });
    const v = validateCredentials(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const info = insertUser.run(v.username, v.displayName, hashPassword(v.password), "owner");
    const token = startSession(info.lastInsertRowid);
    res.status(201).json({
      token,
      user: { id: info.lastInsertRowid, username: v.username, displayName: v.displayName, role: "owner" },
    });
  });

  // Entrar.
  app.post("/auth/login", (req, res) => {
    deleteExpired.run();
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const u = findByUsername.get(username);
    if (!u || !u.active || !verifyPassword(password, u.password_hash))
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    touchLogin.run(u.id);
    const token = startSession(u.id);
    res.json({ token, user: publicUser(u) });
  });

  // Sair.
  app.post("/auth/logout", auth.requireAuth, (req, res) => {
    deleteSession.run(req.token);
    res.status(204).end();
  });

  // Quem sou eu (a interface confirma a sessão ao abrir).
  app.get("/auth/me", auth.requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // Gestão de usuários — só a dona.
  app.get("/api/users", auth.requireAuth, auth.requireOwner, (_req, res) => {
    res.json(
      listUsers.all().map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        role: u.role,
        active: !!u.active,
      }))
    );
  });

  app.post("/api/users", auth.requireAuth, auth.requireOwner, (req, res) => {
    const v = validateCredentials(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    if (findByUsername.get(v.username))
      return res.status(409).json({ error: "Já existe um usuário com esse nome." });
    const role = req.body?.role === "owner" ? "owner" : "staff";
    try {
      const info = insertUser.run(v.username, v.displayName, hashPassword(v.password), role);
      res.status(201).json({ id: info.lastInsertRowid, username: v.username, displayName: v.displayName, role });
    } catch {
      res.status(409).json({ error: "Não foi possível criar o usuário." });
    }
  });
}
