# Precificação — Doceria "Sou Mais Um Doce"

Sistema de precificação para confeitarias. É um **aplicativo de desktop auto-hospedado**:
cada doceria instala a própria cópia na sua máquina (Windows); o app sobe um servidor
local e os aparelhos da loja (PC, celular, tablet) acessam pelo navegador na **rede local**.

- **Cálculo idêntico no app e no servidor** — a regra de negócio vive num módulo único (`pricing-core`).
- **Dados na máquina da doceria** — banco SQLite local; nada na nuvem.
- **Multiusuário com papéis** — visualização, edição e administração, cada um com login próprio.
- **Funciona offline** — fontes embutidas; sem dependência de serviços externos.
- **Acesso remoto (fora da loja)** — fora do escopo da primeira versão.

## Funcionalidades

- **Precificação** de produtos a partir de ingredientes (lançados por receita), embalagens
  (por unidade), rendimento, tempo de produção e custo por minuto — com preço sugerido por
  margem-alvo, arredondamento comercial, preço de revenda e taxas de plataforma.
- **Cadastros** de ingredientes e embalagens, com custo unitário calculado.
- **Parâmetros** de mão de obra e custos fixos mensais (definem o custo por minuto).
- **Ficha técnica** por produto (visualizar e imprimir/salvar em PDF).
- **Histórico de preços** de produtos e de **custos de insumos** — registrado ao salvar,
  apenas quando há mudança, com gráfico e tabela (data, autor e valores).
- **Painel de visão geral** — margens médias, ranking de margem por produto e alertas
  (precificação incompleta, item removido do cadastro, venda abaixo do custo ou do
  sugerido, produto sem preço de venda).
- **Backup completo** — exporta todos os dados, **incluindo o histórico**, em um arquivo
  JSON; a restauração pede confirmação e substitui os dados atuais.
- **Usuários e permissões** — três papéis:
  - *Visualização:* Início e catálogo de Produtos (somente leitura).
  - *Edição:* o anterior + Precificar, Ingredientes e Embalagens (criar/editar/salvar) e os históricos.
  - *Administração:* o anterior + Parâmetros, Configurações, gestão de usuários e backup.

## Estrutura

```
pricing-core/   Núcleo de precificação (puro, sem React/DOM). Usado pelo app e pelo servidor.
                Inclui as validações (validateItem / validateProduct), reutilizadas pela UI.
ui/             Interface React (Vite). Acesso a dados isolado em um ponto (data-store).
                Fontes embutidas via @fontsource (funciona offline).
server/         API Node + Express sobre SQLite. Valida com o pricing-core, registra o
                histórico de preços/custos e expõe exportação/importação (backup).
desktop/        Empacotamento Electron (Windows). Sobe o server e abre a ui. (em aberto)
```

## Decisões de arquitetura

| Tema | Decisão |
|------|---------|
| Distribuição | App de desktop que sobe tudo sozinho |
| SO alvo | Windows |
| Banco | SQLite (1 arquivo por instalação) |
| Valores monetários | Número real (REAL) |
| Exclusão de insumo em uso | Bloqueada (chave estrangeira RESTRICT) |
| Histórico | Append-only; preservado mesmo após excluir o item (nome desnormalizado) |
| Fontes | Embutidas (@fontsource) — funciona offline |
| Acesso | Rede local (Wi-Fi da loja) na 1ª versão |
| Login | Próprio (hash de senha + sessões) com papéis (view/edit/admin) |

## Status

- [x] **Fase 0 — preparação:** `pricing-core` extraído e validado, esquema do banco
      (`server/schema.sql`), contrato da camada de dados (`ui/src/data-store.js`) e acesso
      a dados isolado na UI.
- [x] **Fase 1 — servidor + integração:** API + SQLite + login (sessões) + endpoints de
      dados validados pelo núcleo + interface ligada ao servidor, com papéis de usuário
      (view/edit/admin) e gestão de usuários.
- [x] **Fase 2 — histórico de preços:** instantâneo ao salvar (produtos **e** insumos) +
      telas de histórico com gráfico e tabela.
- [x] **Extras entregues:** backup/exportação completo (com histórico) e restauração com
      confirmação; painel de visão geral (margens, ranking e alertas); fontes embutidas
      (offline); validações centralizadas no núcleo.
- [ ] **Fase 3 — empacotamento desktop:** instalável Electron (Windows) com auto-atualização.

## Desenvolvimento

Requer **Node 22 LTS** (há binário pronto do `better-sqlite3` para a 22; ver `COMO-RODAR.md`).

```bash
npm install            # instala as dependências de todos os pacotes (workspaces)
npm run dev:ui         # interface em modo desenvolvimento (Vite) — http://localhost:5173
npm run dev:server     # API local — http://localhost:4317
```

> **Ao atualizar para uma nova versão:** se o `package.json` mudou (dependências novas),
> rode o `npm install` de novo **antes** de iniciar. Sem isso, o Vite pode acusar
> `Failed to resolve import` para pacotes recém-adicionados (por exemplo, as fontes
> `@fontsource`).

Veja o `COMO-RODAR.md` (passo a passo para Windows) e o README de cada pasta para detalhes.
