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

/* Papéis e permissões. */
export const VALID_ROLES = ["view", "edit", "admin"];
const RANK = { view: 0, edit: 1, admin: 2 };
export const normalizeRole = (r) => (VALID_ROLES.includes(r) ? r : "view");

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

  // "edit" ou "admin" podem alterar dados (produtos, ingredientes, embalagens)
  function requireEditor(req, res, next) {
    if (!req.user || RANK[req.user.role] < RANK.edit)
      return res.status(403).json({ error: "Você não tem permissão para alterar dados." });
    next();
  }

  // só "admin" gerencia usuários, parâmetros e configurações
  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin")
      return res.status(403).json({ error: "Apenas um administrador pode fazer isso." });
    next();
  }

  return { requireAuth, requireEditor, requireAdmin };
}

/* Rotas de autenticação e gestão de usuários. */
export function registerAuthRoutes(app, db, auth) {
  const countUsers = db.prepare("SELECT COUNT(*) AS c FROM users");
  const countActiveAdmins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1");
  const findByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
  const findById = db.prepare("SELECT * FROM users WHERE id = ?");
  const insertUser = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)"
  );
  const createSession = db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  );
  const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
  const deleteUserSessions = db.prepare("DELETE FROM sessions WHERE user_id = ?");
  const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  const touchLogin = db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?");
  const listUsers = db.prepare(
    "SELECT id, username, display_name, role, active, last_login_at FROM users ORDER BY (role='admin') DESC, display_name"
  );
  const setName = db.prepare("UPDATE users SET display_name=? WHERE id=?");
  const setRole = db.prepare("UPDATE users SET role=? WHERE id=?");
  const setActive = db.prepare("UPDATE users SET active=? WHERE id=?");
  const setPassword = db.prepare("UPDATE users SET password_hash=? WHERE id=?");
  const removeUser = db.prepare("DELETE FROM users WHERE id=?");

  const startSession = (userId) => {
    const token = newToken();
    createSession.run(token, userId, SESSION_TTL);
    return token;
  };
  const publicUser = (u) => ({
    id: u.id, username: u.username, displayName: u.display_name, role: u.role, active: !!u.active,
  });

  function credBasics(body) {
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

  // Primeiro acesso: cria a conta ADMINISTRADORA (somente enquanto não houver usuários).
  app.post("/auth/register", (req, res) => {
    if (countUsers.get().c > 0)
      return res.status(403).json({ error: "Já existe uma conta. Peça a um administrador para criar seu usuário." });
    const v = credBasics(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const info = insertUser.run(v.username, v.displayName, hashPassword(v.password), "admin");
    const token = startSession(info.lastInsertRowid);
    res.status(201).json({ token, user: publicUser(findById.get(info.lastInsertRowid)) });
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

  /* -------------------- Gestão de usuários (somente admin) -------------------- */
  app.get("/api/users", auth.requireAuth, auth.requireAdmin, (_req, res) => {
    res.json(
      listUsers.all().map((u) => ({
        id: u.id, username: u.username, displayName: u.display_name,
        role: u.role, active: !!u.active, lastLoginAt: u.last_login_at,
      }))
    );
  });

  app.post("/api/users", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const v = credBasics(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    if (findByUsername.get(v.username))
      return res.status(409).json({ error: "Já existe um usuário com esse nome." });
    try {
      const info = insertUser.run(v.username, v.displayName, hashPassword(v.password), normalizeRole(req.body?.role));
      res.status(201).json(publicUser(findById.get(info.lastInsertRowid)));
    } catch {
      res.status(409).json({ error: "Não foi possível criar o usuário." });
    }
  });

  app.put("/api/users/:id", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = findById.get(id);
    if (!u) return res.status(404).json({ error: "Usuário não encontrado." });
    const body = req.body || {};

    const newRole = body.role !== undefined ? normalizeRole(body.role) : u.role;
    const newActive = body.active !== undefined ? (body.active ? 1 : 0) : u.active;

    // invariante: sempre deve restar ao menos um administrador ativo
    const lastActiveAdmin = u.role === "admin" && u.active === 1 && countActiveAdmins.get().c <= 1;
    if (lastActiveAdmin && (newRole !== "admin" || newActive === 0))
      return res.status(409).json({ error: "Não é possível rebaixar ou desativar o último administrador ativo. Promova outro administrador antes." });
    if (id === req.user.id && newActive === 0)
      return res.status(409).json({ error: "Você não pode desativar a própria conta." });

    if (body.password !== undefined && String(body.password) !== "") {
      if (String(body.password).length < MIN_PASSWORD)
        return res.status(400).json({ error: `A senha precisa de ao menos ${MIN_PASSWORD} caracteres.` });
      setPassword.run(hashPassword(String(body.password)), id);
    }
    if (body.displayName !== undefined) setName.run(String(body.displayName).trim() || u.display_name, id);
    if (body.role !== undefined) setRole.run(newRole, id);
    if (body.active !== undefined) {
      setActive.run(newActive, id);
      if (newActive === 0) deleteUserSessions.run(id); // desativar encerra as sessões abertas
    }
    res.json(publicUser(findById.get(id)));
  });

  app.delete("/api/users/:id", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = findById.get(id);
    if (!u) return res.status(404).json({ error: "Usuário não encontrado." });
    if (id === req.user.id)
      return res.status(409).json({ error: "Você não pode excluir a própria conta." });
    if (u.role === "admin" && u.active === 1 && countActiveAdmins.get().c <= 1)
      return res.status(409).json({ error: "Não é possível excluir o último administrador ativo." });
    removeUser.run(id); // as sessões do usuário caem por CASCADE
    res.status(204).end();
  });
}
