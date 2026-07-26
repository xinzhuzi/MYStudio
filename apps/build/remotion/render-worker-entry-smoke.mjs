import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, utilityProcess } from "electron";

export async function runRenderWorkerEntrySmoke({
  workerPath = path.resolve(process.cwd(), "out/main/remotion-render-worker.cjs"),
} = {}) {
  if (!path.isAbsolute(workerPath) || !fs.existsSync(workerPath)) {
    throw new Error(`Remotion render worker 构建产物不存在: ${workerPath}`);
  }
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-entry-smoke-"));
  let child;
  try {
    await app.whenReady();
    await new Promise((resolve, reject) => {
      let completed = false;
      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        reject(new Error("Remotion render worker entry smoke 超时"));
      }, 10_000);
      child = utilityProcess.fork(workerPath, [], {
        cwd: runtimeDir,
        serviceName: "MYStudio Remotion Render Entry Smoke",
      });
      child.on("message", (message) => {
        if (completed) return;
        if (message?.kind !== "error"
          || message.requestId !== "entry-smoke"
          || typeof message.message !== "string"
          || !message.message.includes("input.plan")) {
          completed = true;
          clearTimeout(timer);
          reject(new Error(`Remotion render worker 返回异常事件: ${JSON.stringify(message)}`));
          return;
        }
        completed = true;
        clearTimeout(timer);
        resolve();
      });
      child.on("exit", (code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        reject(new Error(`Remotion render worker 在响应前退出(code=${code})`));
      });
      child.postMessage({
        schemaVersion: 1,
        requestId: "entry-smoke",
        action: "render",
        input: {},
      });
    });
    console.log(`Remotion render worker entry smoke 通过: ${workerPath}`);
  } finally {
    child?.kill();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    app.quit();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRenderWorkerEntrySmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    app.quit();
  });
}
