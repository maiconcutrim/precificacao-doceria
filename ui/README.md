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
- No protótipo, `App.jsx` traz um repositório local interno (`createLocalRepo`).

## Pendências de integração (Fase 1)

- [ ] Importar as funções de cálculo de `@doceria/pricing-core` em vez de mantê-las
      embutidas em `App.jsx` (mesma lógica, fonte única).
- [ ] Trocar o repositório local pelo `createApiStore` de `data-store.js`,
      apontando para a API do servidor.
- [ ] Adicionar a tela de login (consumindo `/auth/login`).
