// Task-only fresh Electron startup probe. No existing process attachment.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
process.stderr.write(`probe entry ${process.pid}\n`);
app.setPath('userData', path.resolve(process.argv[2]));
let window;
app.whenReady().then(async () => {
  process.stderr.write('probe app ready\n');
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL('data:text/html,<title>Isolated Canvas probe</title>');
  process.stderr.write('probe window loaded\n');
  const result = await window.webContents.executeJavaScript('({canvas: !!document.createElement("canvas").getContext("2d")})');
  process.stdout.write(JSON.stringify(result) + '\n');
  window.destroy();
  app.quit();
}).catch((error) => { process.stderr.write(String(error) + '\n'); app.exit(1); });
