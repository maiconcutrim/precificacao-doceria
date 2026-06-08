const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const isDev = !app.isPackaged;
const PORT = process.env.PORT || 4317;

let serverProcess = null;

/**
 * Sobe o servidor local (Node + Express + SQLite) como processo filho.
 * Em produção usa o Node embutido do Electron (ELECTRON_RUN_AS_NODE).
 */
function startServer() {
  const serverEntry = path.join(__dirname, "..", "server", "src", "index.js");
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(PORT) },
    stdio: "inherit",
  });
  serverProcess.on("exit", (code) => {
    console.log(`servidor encerrou (código ${code})`);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Precificação — Doceria",
    webPreferences: {
      // a interface roda no servidor local; sem integração de Node no renderer
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Em dev, a interface vem do Vite (porta 5173).
  // Em produção, o servidor servirá a interface já construída na própria porta
  // (TODO Fase 1: express.static de ui/dist), e os aparelhos da loja acessam
  // pelo IP da máquina nessa mesma porta.
  const urlToLoad = isDev ? "http://localhost:5173" : `http://localhost:${PORT}`;
  win.loadURL(urlToLoad);
}

app.whenReady().then(() => {
  startServer();
  // pequena espera para o servidor subir antes de abrir a janela
  setTimeout(createWindow, 800);

  // TODO Fase 3: auto-atualização
  // const { autoUpdater } = require("electron-updater");
  // autoUpdater.checkForUpdatesAndNotify();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  if (serverProcess) serverProcess.kill();
});
