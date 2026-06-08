# Precificação — Doceria

Sistema de precificação para confeitarias. É um **aplicativo de desktop auto-hospedado**:
cada doceria instala a própria cópia na sua máquina (Windows); o app sobe um servidor
local e os aparelhos da loja (PC, celular, tablet) acessam pelo navegador na **rede local**.

- **Cálculo idêntico no app e no servidor** — a regra de negócio vive num módulo único (`pricing-core`).
- **Dados na máquina da doceria** — banco SQLite local; nada na nuvem.
- **Multiusuário** — dona e funcionárias, com login próprio.
- **Acesso remoto (fora da loja)** — fora do escopo da primeira versão.

## Estrutura

```
pricing-core/   Núcleo de precificação (puro, sem React/DOM). Usado pelo app e pelo servidor.
ui/             Interface React (Vite). Hoje fala com a camada de dados; troca local ⇄ API num só ponto.
server/         API Node + Express sobre SQLite. Valida com o pricing-core e registra histórico de preços.
desktop/        Empacotamento Electron (Windows) com auto-atualização. Sobe o server e abre a ui.
```

## Decisões de arquitetura

| Tema | Decisão |
|------|---------|
| Distribuição | App de desktop que sobe tudo sozinho |
| SO alvo | Windows |
| Banco | SQLite (1 arquivo por instalação) |
| Valores monetários | Número real (REAL) |
| Exclusão de insumo em uso | Bloqueada (chave estrangeira RESTRICT) |
| Acesso | Rede local (Wi-Fi da loja) na 1ª versão |
| Login | Próprio (hash de senha + sessões) |

## Status

- [x] **Fase 0 — preparação:** `pricing-core` extraído e validado, esquema do banco (`server/schema.sql`),
      contrato da camada de dados (`ui/src/data-store.js`), e acesso a dados isolado na UI.
- [ ] **Fase 1 — servidor:** API + SQLite + login + endpoints de dados + importação do backup JSON.
- [ ] **Fase 2 — histórico de preços:** instantâneo ao salvar + tela de histórico.
- [ ] **Fase 3 — multiusuário e offline:** papéis, cache offline, armazenamento de logos.

## Desenvolvimento

Requer Node 18+.

```bash
npm install            # instala as dependências de todos os pacotes (workspaces)
npm run dev:ui         # interface em modo desenvolvimento (Vite)
npm run dev:server     # API local (quando implementada)
```

Veja o README de cada pasta para detalhes.
