// Fenêtre minimale pour tester la console d'administration dans Chromium.
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1280, height: 800 });
  window.loadURL(process.env.CONSOLE_URL);
});
