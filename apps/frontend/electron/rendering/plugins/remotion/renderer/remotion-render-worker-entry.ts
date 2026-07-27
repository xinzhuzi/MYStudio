import { RemotionRenderWorker } from "./remotion-render-worker";
import {
  validateRemotionRenderWorkerCommand,
  validateRemotionRenderWorkerEvent,
  type RemotionRenderWorkerCommand,
  type RemotionRenderWorkerEvent,
} from "./remotion-render-worker-protocol";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error("Remotion render worker 必须运行在 Electron utility process");
}

let activeRequestId: string | null = null;
let renderPromise: Promise<void> | null = null;

const emit = (event: RemotionRenderWorkerEvent): void => {
  const validated = validateRemotionRenderWorkerEvent(event);
  if (!validated.success) {
    throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  parentPort.postMessage(validated.value);
};

const worker = new RemotionRenderWorker({
  emitProgress: (progress) => {
    if (!activeRequestId) return;
    emit({ kind: "progress", requestId: activeRequestId, progress });
  },
});

parentPort.on("message", (messageEvent) => {
  const validated = validateRemotionRenderWorkerCommand(messageEvent.data);
  if (!validated.success) {
    emit({
      kind: "error",
      requestId: extractRequestId(messageEvent.data),
      message: validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    });
    process.exitCode = 1;
    return;
  }
  void handleCommand(validated.value);
});

async function handleCommand(command: RemotionRenderWorkerCommand): Promise<void> {
  if (command.action === "cancel") {
    if (activeRequestId === null || renderPromise === null) {
      emit({ kind: "error", requestId: command.requestId, message: `未找到运行中的 Remotion 任务: ${command.jobId}` });
      return;
    }
    worker.cancel(command.jobId);
    return;
  }
  if (renderPromise) {
    emit({ kind: "error", requestId: command.requestId, message: "Remotion utility process 只允许一个渲染任务" });
    return;
  }
  activeRequestId = command.requestId;
  renderPromise = worker.render(command.input)
    .then((result) => emit({ kind: "result", requestId: command.requestId, result }))
    .catch((error: unknown) => emit({
      kind: "error",
      requestId: command.requestId,
      message: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      activeRequestId = null;
      renderPromise = null;
      setImmediate(() => process.exit(0));
    });
}

function extractRequestId(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const requestId = (value as { requestId?: unknown }).requestId;
    if (typeof requestId === "string" && requestId.trim()) return requestId.trim();
  }
  return "invalid-request";
}
