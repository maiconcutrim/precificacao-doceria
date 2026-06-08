# Como subir este projeto para o GitHub

Você precisa do **Git** instalado (https://git-scm.com/download/win) e de uma conta no GitHub.

## 1. Criar o repositório vazio no GitHub
1. Acesse https://github.com/new
2. Dê um nome (ex.: `precificacao-doceria`).
3. **Não** marque "Add a README", "Add .gitignore" nem "license" — o projeto já traz tudo.
4. Clique em **Create repository** e copie a URL que aparece
   (ex.: `https://github.com/SEU-USUARIO/precificacao-doceria.git`).

## 2. Enviar o projeto
Abra o terminal (PowerShell ou Git Bash) **dentro da pasta do projeto** (a que contém
o `README.md` e as pastas `pricing-core/`, `ui/`, `server/`, `desktop/`) e rode:

```bash
git init
git add .
git commit -m "Estrutura inicial: pricing-core, schema, data-store e esqueleto server/desktop"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/precificacao-doceria.git
git push -u origin main
```

Na primeira vez, o Git pode pedir login no GitHub — autentique pelo navegador quando solicitado.

## 3. Conferir
Atualize a página do repositório no GitHub: os arquivos devem aparecer lá.

---

### Observações
- A pasta `node_modules/` e o arquivo do banco (`*.db`) **não** vão para o GitHub
  de propósito (estão no `.gitignore`). Cada pessoa roda `npm install` para baixar as dependências.
- Para rodar localmente depois de clonar:
  ```bash
  npm install
  npm run dev:ui
  ```
