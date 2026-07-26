import { ensureBrowser } from "@remotion/renderer";
import {
  createPreparedVersionFileStore,
  createRemotionBrowserWorkerService,
  type RemotionEnsureBrowser,
} from "./remotion-browser-worker-service";

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
});

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
