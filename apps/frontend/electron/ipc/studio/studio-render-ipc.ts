import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { listStudioRuntimeAssets } from "../../storage/studio-runtime-assets";
import type { DiagnosticsLogEntryInput } from "../../../types/diagnostics";
import type { StudioAssetListRequest } from "../../../types/studio-assets";

type StudioSaveMaterialPayload = { name: string; bytes: ArrayBuffer | Uint8Array };
type RegisterStudioRenderIpcHandlersContext = {
  getMediaRoot: () => string;
  resolveSourcePath: (sourcePath: string) => string;
  createOperationId: (prefix: string) => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
};

const execFileAsync = promisify(execFile);

export interface StudioMediaProbeEvidence {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  duration: number;
  streams: string[];
}

export async function probeStudioMediaEvidence(resolvedPath: string): Promise<StudioMediaProbeEvidence> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", resolvedPath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const probe = JSON.parse(stdout || "{}") as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string }>;
  };
  const stat = await fs.promises.stat(resolvedPath);
  const sha256 = crypto.createHash("sha256").update(await fs.promises.readFile(resolvedPath)).digest("hex");
  return {
    path: resolvedPath,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256,
    duration: Number(probe.format?.duration || 0),
    streams: (probe.streams || []).map((stream) => stream.codec_type || "").filter(Boolean),
  };
}

export function registerStudioRenderIpcHandlers({
  getMediaRoot,
  resolveSourcePath,
  createOperationId,
  writeDiagnosticsLog,
}: RegisterStudioRenderIpcHandlersContext) {
  const ensureDir = (dirPath: string) => fs.mkdirSync(dirPath, { recursive: true });
  const getStudioAssetsRoot = () => {
    const base = path.join(getMediaRoot(), "studio-assets");
    ensureDir(base);
    return base;
  };
  const ensureReadableStudioSource = (sourcePath: string) => {
    const resolved = resolveSourcePath(sourcePath);
    if (!fs.existsSync(resolved)) throw new Error(`素材不存在: ${sourcePath}`);
    return resolved;
  };
  const sanitizeStudioFilename = (name: string) => {
    const ext = path.extname(name).toLowerCase() || ".bin";
    const base = path.basename(name, ext).trim().toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "").slice(0, 42) || "material";
    return `${base}-${crypto.randomUUID()}${ext}`;
  };
  ipcMain.handle("studio-save-material", async (_event, payload: StudioSaveMaterialPayload) => {
    const operationId = createOperationId("studio-save-material");
    try {
      const filename = sanitizeStudioFilename(payload.name);
      const filePath = path.join(getStudioAssetsRoot(), filename);
      const buffer = Buffer.from(payload.bytes instanceof Uint8Array ? payload.bytes : new Uint8Array(payload.bytes));
      writeDiagnosticsLog({
        level: "info", category: "storage", operationId, message: "Studio material save started",
        context: { name: payload.name, filename, size: buffer.length },
      });
      if (buffer.length === 0) {
        writeDiagnosticsLog({
          level: "error", category: "storage", operationId, message: "Studio material save failed",
          context: { name: payload.name, filename, error: "素材文件为空" },
        });
        return { success: false, error: "素材文件为空" };
      }
      await fs.promises.writeFile(filePath, buffer);
      writeDiagnosticsLog({
        level: "info", category: "storage", operationId, message: "Studio material save completed",
        context: { name: payload.name, filename, filePath, size: buffer.length },
      });
      return { success: true, localPath: `local-image://studio-assets/${filename}`, filePath, size: buffer.length };
    } catch (error) {
      writeDiagnosticsLog({
        level: "error", category: "storage", operationId, message: "Studio material save errored",
        context: { name: payload.name }, error,
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("studio-list-assets", async (_event, payload: StudioAssetListRequest) => listStudioRuntimeAssets(payload));
  ipcMain.handle("studio-probe-media-evidence", async (_event, sourcePath: string) => {
    const resolvedPath = ensureReadableStudioSource(sourcePath);
    return probeStudioMediaEvidence(resolvedPath);
  });
}
