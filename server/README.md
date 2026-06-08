# @doceria/server

API local em Node + Express sobre SQLite. No produto final ela roda embutida no
app de desktop e atende os aparelhos da loja pela rede local.

## Rodar em desenvolvimento

```bash
npm install
cp .env.example .env
npm run dev
```

Saúde: `GET http://localhost:4317/api/health`.

## Banco

- `schema.sql` — esquema completo (tabelas, chaves, índices, migrações).
- `src/db.js` — abre o SQLite, aplica o esquema (idempotente), liga `foreign_keys`
  e o modo `WAL`, e garante as linhas únicas de `business` e `parameters`.
- O arquivo do banco fica em `DB_PATH` (padrão `./data/doceria.db`, ignorado pelo git).

## Autenticação

Login próprio, sem dependências nativas: senhas com **scrypt** (embutido no Node) e
sessões na tabela `sessions` (token aleatório com validade de 30 dias). Ver `src/auth.js`.

- Primeiro acesso cria a conta da **dona** (`/auth/register`, só enquanto não há usuários).
- Demais usuários são criados pela dona em `/api/users`.
- Toda rota de dados exige sessão válida (`Authorization: Bearer <token>`).

## Rotas

| Método | Rota | Situação |
|--------|------|----------|
| GET  | `/api/health` | pronto |
| GET  | `/auth/status` | pronto |
| POST | `/auth/register` (1º acesso → dona) | pronto |
| POST | `/auth/login` | pronto |
| POST | `/auth/logout` | pronto |
| GET  | `/auth/me` | pronto |
| GET/POST | `/api/users` (só a dona) | pronto |
| GET  | `/api/state` | pronto |
| PUT  | `/api/ingredients`, `/api/packaging`, `/api/parameters`, `/api/products`, `/api/config` | pronto |
| POST | `/api/import` (migração do backup JSON) | pronto |

As rotas de dados validam com `@doceria/pricing-core` antes de gravar, e a gravação
de produtos registra um instantâneo em `price_history`.
