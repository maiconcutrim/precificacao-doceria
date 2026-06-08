# @doceria/desktop

Empacotamento do app de desktop (Windows) com Electron. Ao abrir, ele sobe o
servidor local e mostra a interface; os aparelhos da loja acessam a mesma
instância pelo IP da máquina na rede local.

## Rodar em desenvolvimento

Em terminais separados:

```bash
# 1) interface (Vite)
npm run dev --workspace ui

# 2) app de desktop (abre a janela apontando para o Vite e sobe o servidor)
npm run dev --workspace desktop
```

## Gerar o instalador (Windows)

```bash
npm run build --workspace ui        # gera ui/dist
npm run build --workspace desktop   # gera o instalador .exe (electron-builder)
```

## Como funciona

- `main.js` sobe o servidor (`../server/src/index.js`) como processo filho e abre
  uma janela apontando para a interface.
- Em produção, o servidor servirá a interface construída (`ui/dist`) na própria
  porta — assim o PC, o celular e o tablet carregam tudo do mesmo endereço.

## Pendências (fases seguintes)

- [ ] Servidor servir `ui/dist` como estático (Fase 1).
- [ ] Auto-atualização com `electron-updater` (Fase 3).
- [ ] Ícone do app e ajustes do instalador NSIS.
