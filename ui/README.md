# @doceria/ui

Interface React (Vite) do sistema de precificação. É a evolução do protótipo já
validado — todo o fluxo de telas (precificar, produtos, ingredientes, embalagens,
parâmetros, configurações, início) está em `src/App.jsx`.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

`vite.config.js` usa `host: true`, então o endereço de rede que o Vite imprime
pode ser aberto de outros aparelhos na mesma rede (útil para testar no celular).

## Camada de dados

A UI nunca acessa armazenamento ou rede diretamente — ela usa um **repositório**
com interface de domínio (`loadAll`, `saveIngredients`, ...). Trocar a origem dos
dados é trocar a implementação num único ponto.

- `src/data-store.js` — implementação de **produção** (`createApiStore`), que fala
  com a API local do servidor.
- `App.jsx` cria o repositório com `createApiStore` usando o token da sessão. Em
  desenvolvimento (Vite em :5173) ele fala com o servidor em :4317; empacotado, usa
  a mesma origem.

## Integração com o servidor (Fase 1 — concluída)

- [x] Conecta à API do servidor (`createApiStore`), com token de sessão.
- [x] Tela de login / primeiro acesso e botão Sair no cabeçalho.
- [x] Importação do backup via `/api/import`.
- [x] Cálculo importado de `@doceria/pricing-core` (fonte única, igual ao servidor).
