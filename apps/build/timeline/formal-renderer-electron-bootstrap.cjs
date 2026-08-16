const { pathToFileURL } = require("node:url");
const electron = require("electron");

if (!electron.app || !electron.utilityProcess) {
  throw new Error("formal renderer bootstrap requires Electron main-process APIs");
}

globalThis.__MYSTUDIO_FORMAL_ELECTRON_MAIN__ = {
  app: electron.app,
  utilityProcess: electron.utilityProcess,
};

const viteNodePath = require.resolve("vite-node/vite-node.mjs");
process.argv[1] = viteNodePath;
import(pathToFileURL(viteNodePath).href).catch((error) => {
  console.error(error);
  electron.app.exit(1);
});
