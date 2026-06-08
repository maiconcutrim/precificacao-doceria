import express from "express";
import cors from "cors";
import { openDatabase } from "./db.js";
import { makeAuth, registerAuthRoutes } from "./auth.js";
import { registerDataRoutes } from "./data.js";

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
/*  Autenticação (login próprio)                                      */
/* ------------------------------------------------------------------ */
registerAuthRoutes(app, db, auth);

/* ------------------------------------------------------------------ */
/*  Dados (contrato em ui/src/data-store.js) — protegidos por sessão  */
/*    GET  /api/state          estado completo do negócio             */
/*    PUT  /api/ingredients|packaging|parameters|products|config      */
/*    POST /api/import          migração do backup JSON               */
/* ------------------------------------------------------------------ */
registerDataRoutes(app, db, auth);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor da doceria em http://0.0.0.0:${PORT}`);
  console.log(`Na rede local, os aparelhos acessam pelo IP da máquina, ex.: http://192.168.0.10:${PORT}`);
});
