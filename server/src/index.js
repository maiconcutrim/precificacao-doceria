import express from "express";
import cors from "cors";
import { openDatabase } from "./db.js";
import { makeAuth, registerAuthRoutes } from "./auth.js";
// As rotas de dados validarão com o núcleo compartilhado antes de gravar:
// import { validateProduct, validateItem, computeProduct } from "@doceria/pricing-core";

const PORT = Number(process.env.PORT) || 4317;

const db = openDatabase();
const auth = makeAuth(db);

const app = express();
app.use(cors());                 // libera acesso dos aparelhos da loja na rede local
app.use(express.json({ limit: "5mb" }));

/* ------------------------------------------------------------------ */
/*  Saúde                                                              */
/* ------------------------------------------------------------------ */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "doceria-server", version: "0.1.0" });
});

/* ------------------------------------------------------------------ */
/*  Autenticação (login próprio) — implementada                       */
/*    GET  /auth/status        precisa de primeiro acesso?            */
/*    POST /auth/register       cria a conta da dona (1º acesso)       */
/*    POST /auth/login          entra e devolve token de sessão        */
/*    POST /auth/logout         encerra a sessão                       */
/*    GET  /auth/me             usuário da sessão atual                */
/*    GET/POST /api/users       gestão de usuários (só a dona)         */
/* ------------------------------------------------------------------ */
registerAuthRoutes(app, db, auth);

/* ------------------------------------------------------------------ */
/*  Dados (contrato em ui/src/data-store.js) — protegidos por sessão  */
/*  Lógica de gravação/leitura: TODO próxima etapa da Fase 1.          */
/* ------------------------------------------------------------------ */
app.get("/api/state", auth.requireAuth, notImplemented);
app.put("/api/ingredients", auth.requireAuth, notImplemented);
app.put("/api/packaging", auth.requireAuth, notImplemented);
app.put("/api/parameters", auth.requireAuth, notImplemented);
app.put("/api/products", auth.requireAuth, notImplemented);   // ao gravar, registrar price_history
app.put("/api/config", auth.requireAuth, notImplemented);
app.post("/api/import", auth.requireAuth, notImplemented);     // migração do backup JSON

function notImplemented(_req, res) {
  res.status(501).json({ error: "Ainda não implementado (Fase 1)." });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor da doceria em http://0.0.0.0:${PORT}`);
  console.log(`Na rede local, os aparelhos acessam pelo IP da máquina, ex.: http://192.168.0.10:${PORT}`);
});
