# Como rodar e testar o projeto (Windows)

Este guia prepara o computador e roda o que já está pronto: a **interface** e a
**API com autenticação**.

## Pré-requisitos

1. **Node.js 22 LTS** — baixe em https://nodejs.org/en/download e escolha a versão **22.x**
   (se aparecer a 24, clique em "Previous Releases" e pegue a 22.x). Instale com as
   opções padrão. Já vem com o `npm`.
   > Importante: use a **22**, não a 24. O pacote do banco (`better-sqlite3`) tem binário
   > pronto para a 22, então a instalação não precisa compilar nada nem do Visual Studio.
2. **(Opcional) Git** — só se for subir para o GitHub: https://git-scm.com/download/win

Confirme no PowerShell (menu Iniciar → "PowerShell"):

```powershell
node -v
npm -v
```

`node -v` deve mostrar `v22.x.x`.

## Preparar o projeto

3. **Descompacte** o projeto numa pasta, por exemplo `Documentos\precificacao-doceria`.
4. No PowerShell, entre na pasta (a que tem este arquivo e o `README.md`):

   ```powershell
   cd "$HOME\Documents\precificacao-doceria"
   ```

5. **Instale as dependências.** Para testar agora (interface + servidor), você não
   precisa do Electron — esta instalação enxuta é mais rápida:

   ```powershell
   npm install -w pricing-core -w server -w ui
   ```

   (Quando for empacotar o app de desktop, rode o `npm install` completo, que inclui o
   Electron.) Demora alguns minutos na primeira vez e precisa de internet.

## Rodar a interface

6. Ainda na pasta do projeto:

   ```powershell
   npm run dev:ui
   ```

   O Vite mostra um endereço (ex.: `http://localhost:5173`). Abra no navegador — a
   interface completa aparece. Para parar, volte ao PowerShell e tecle `Ctrl + C`.

   > Na **primeira vez**, a interface mostra a tela de **primeiro acesso** para criar a
   > conta da dona; depois, a tela de **login**. A interface conversa com o servidor
   > (passo abaixo), então rode os dois juntos.

## Rodar e testar o servidor

7. Abra **outra** janela do PowerShell (deixe a interface rodando na primeira), entre
   na pasta de novo e rode:

   ```powershell
   npm run dev:server
   ```

   Ele imprime `Servidor da doceria em http://0.0.0.0:4317`.

8. **Teste de saúde:** no navegador, abra `http://localhost:4317/api/health` — deve
   responder `{"ok":true,...}`.

9. **Teste da autenticação** (no PowerShell, com o servidor rodando):

   ```powershell
   # É o primeiro acesso? (deve dizer needsSetup: true)
   Invoke-RestMethod http://localhost:4317/auth/status

   # Criar a conta da dona
   Invoke-RestMethod -Method Post http://localhost:4317/auth/register -ContentType application/json -Body '{"username":"leandra","password":"segredo123","displayName":"Leandra"}'

   # Entrar
   Invoke-RestMethod -Method Post http://localhost:4317/auth/login -ContentType application/json -Body '{"username":"leandra","password":"segredo123"}'
   ```

   O `register` e o `login` devem devolver um `token` e os dados do usuário —
   confirmando que senha, sessão e login funcionam.

   > O banco de dados é criado automaticamente em `server/data/doceria.db` no primeiro
   > uso. Para recomeçar do zero, basta parar o servidor e apagar esse arquivo.

## Observações

- **Interface ↔ servidor** já estão ligados: rode `dev:server` e `dev:ui` juntos.
  No primeiro acesso, crie a conta da dona; os dados são salvos no servidor (SQLite).
- No `npm install`, o pacote do banco (`better-sqlite3`) baixa uma versão pronta para
  Windows **quando você usa o Node 22**. Se aparecer erro de compilação mencionando
  `prebuild-install ... No prebuilt binaries found` e `Visual Studio`/`Windows SDK`, é
  sinal de que está rodando numa versão de Node sem binário pronto (ex.: a 24). Solução:
  instale o **Node 22 LTS**, apague `node_modules` e `package-lock.json` e rode o
  `npm install` de novo.

## Recomeçar uma instalação que falhou

```powershell
# feche o VS Code e outras janelas de terminal antes
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install -w pricing-core -w server -w ui
```

## Comandos úteis (resumo)

```powershell
npm install            # instala tudo
npm run dev:ui         # interface (http://localhost:5173)
npm run dev:server     # API (http://localhost:4317)
```
