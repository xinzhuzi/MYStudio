import { ensureBrowser } from "@remotion/renderer";
import {
  createPreparedVersionFileStore,
  createRemotionBrowserWorkerService,
  type RemotionEnsureBrowser,
} from "./remotion-browser-worker-service";
import { installUncaughtExceptionGuard } from "../../../../runtime/uncaught-exception-guard";

// utility 子进程有独立运行时,主进程的 uncaughtException 守卫罩不到这里;
// undici setTypeOfService EINVAL(上游 undici#5544)必须各自过滤。
installUncaughtExceptionGuard({
  writeLog: (entry) => {
    console.warn(`[remotion-browser-worker] ${entry.level}: ${entry.message}`);
  },
});

// Handle exactly one request per fresh utility process. The no-download status
// sentinel rejects Remotion's module-global ensureBrowser chain, so reusing the
// same process could poison the following status/download request.
const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error("Remotion browser worker 必须运行在 Electron utility process");
}

const service = createRemotionBrowserWorkerService({
  ensureBrowser: ensureBrowser as RemotionEnsureBrowser,
  store: createPreparedVersionFileStore(process.cwd()),
  downloadTimeoutMs: readDownloadTimeoutMs(),
});

function readDownloadTimeoutMs(): number | undefined {
  const raw = process.env.MYSTUDIO_REMOTION_BROWSER_DOWNLOAD_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("MYSTUDIO_REMOTION_BROWSER_DOWNLOAD_TIMEOUT_MS 必须是正数");
  }
  return value;
}

parentPort.once("message", (messageEvent) => {
  void service.handle(messageEvent.data, (event) => {
    parentPort.postMessage(event);
  }).then((terminal) => {
    process.exit(terminal.kind === "error" ? 1 : 0);
  }).catch((error: unknown) => {
    parentPort.postMessage({
      kind: "error",
      requestId: "invalid-request",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
});
