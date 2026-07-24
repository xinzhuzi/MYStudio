import { registerFileStorageIpcHandlers } from "./file-storage-ipc";
import { registerImageHostIpcHandlers } from "./image-host-ipc";
import { registerLocalMediaIpcHandlers } from "./local-media-ipc";
import type { DiagnosticsLogEntryInput } from "../../types/diagnostics";

export type RegisterStorageMediaIpcHandlersContext = {
  getDataDir: () => string;
  getMediaRoot: () => string;
  createOperationId: (prefix: string) => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
  readImageSource: (imageData: string) => Promise<{ buffer: Buffer; mimeType: string }>;
};

export function registerStorageMediaIpcHandlers({
  getDataDir,
  getMediaRoot,
  createOperationId,
  writeDiagnosticsLog,
  readImageSource,
}: RegisterStorageMediaIpcHandlersContext) {
  registerLocalMediaIpcHandlers({ getMediaRoot });
  registerImageHostIpcHandlers({
    createOperationId: () => createOperationId("image-host"),
    writeDiagnosticsLog,
    readImageSource,
  });
  registerFileStorageIpcHandlers({ getDataDir });
}
