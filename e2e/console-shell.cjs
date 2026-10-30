// Fenêtre minimale pour tester la console d'administration dans Chromium.
const { join } = require('node:path');
const { app, BrowserWindow, session } = require('electron');
app.whenReady().then(() => {
  // Les téléchargements arrivent sur le disque, où le test peut vérifier leur contenu.
  session.defaultSession.on('will-download', (_event, item) => item.setSavePath(join(process.env.DOWNLOAD_DIR, item.getFilename())));
  const window = new BrowserWindow({ width: 1280, height: 800 });
  window.loadURL(process.env.CONSOLE_URL);
});
