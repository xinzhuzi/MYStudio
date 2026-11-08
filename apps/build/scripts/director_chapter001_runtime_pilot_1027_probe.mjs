// Reproduce Electron ESM startup ordering without touching an existing process.
const { app } = await import('electron');
process.stderr.write('ESM entered before top-level whenReady await\n');
app.setPath('userData', process.argv[2]);
await app.whenReady();
process.stderr.write('ESM app ready\n');
app.quit();
