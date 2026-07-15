import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserWindow, ipcMain } from "electron";
import { createTimelineRenderRuntime } from "../timeline-render-runtime";
import { listStudioRuntimeAssets } from "../studio-runtime-assets";
import type { DiagnosticsLogEntryInput } from "../../types/diagnostics";
import type { StudioAssetListRequest } from "../../types/studio-assets";
import type { EpisodeMergePlan, TrackRenderInput, TrackRenderPlan } from "../../types/studio";

type StudioSaveMaterialPayload = { name: string; bytes: ArrayBuffer | Uint8Array };
type RegisterStudioRenderIpcHandlersContext = {
  getMediaRoot: () => string;
  resolveSourcePath: (sourcePath: string) => string;
  createOperationId: (prefix: string) => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
};

const execFileAsync = promisify(execFile);

export function registerStudioRenderIpcHandlers({
  getMediaRoot,
  resolveSourcePath,
  createOperationId,
  writeDiagnosticsLog,
}: RegisterStudioRenderIpcHandlersContext) {
  const ensureDir = (dirPath: string) => fs.mkdirSync(dirPath, { recursive: true });
  const getStudioRenderRoot = () => {
    const base = path.join(getMediaRoot(), "studio-render");
    ensureDir(base);
    return base;
  };
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
  const createStudioRenderName = (prefix: string) => `${prefix}-${crypto.randomUUID()}.mp4`;
  const sanitizeStudioFilename = (name: string) => {
    const ext = path.extname(name).toLowerCase() || ".bin";
    const base = path.basename(name, ext).trim().toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "").slice(0, 42) || "material";
    return `${base}-${crypto.randomUUID()}${ext}`;
  };
  let timelineRenderRuntime: ReturnType<typeof createTimelineRenderRuntime> | null = null;
  const getTimelineRenderRuntime = () => {
    if (timelineRenderRuntime) return timelineRenderRuntime;
    timelineRenderRuntime = createTimelineRenderRuntime({
      renderRoot: getStudioRenderRoot(),
      resolveSourcePath: ensureReadableStudioSource,
      emitProgress: (progress) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send("studio-timeline-render-progress", progress);
        }
      },
    });
    return timelineRenderRuntime;
  };
  const srtTime = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = Math.floor(safeSeconds % 60);
    const ms = Math.floor((safeSeconds % 1) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };
  const escapeSubtitlePath = (filePath: string) => (
    filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")
  );
  const assertFfmpegAvailable = async () => {
    try {
      await execFileAsync("ffmpeg", ["-version"], { maxBuffer: 1024 * 1024 });
    } catch {
      throw new Error("未找到本地 ffmpeg，请先安装 ffmpeg 并确保命令行可访问");
    }
  };
  const renderStudioSegment = async (input: TrackRenderInput, outputPath: string) => {
    const sourcePath = ensureReadableStudioSource(input.sourcePath);
    const audioPath = input.audioPath ? ensureReadableStudioSource(input.audioPath) : null;
    const duration = Math.max(0.2, Number(input.duration) || 5);
    const videoFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p";
    const audioInputArgs = audioPath
      ? ["-i", audioPath]
      : ["-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"];
    if (input.sourceKind === "image") {
      await execFileAsync("ffmpeg", [
        "-loop", "1", "-t", String(duration), "-i", sourcePath, ...audioInputArgs,
        "-vf", videoFilter, "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-shortest", "-y", outputPath,
      ], { maxBuffer: 50 * 1024 * 1024 });
      return;
    }
    await execFileAsync("ffmpeg", [
      "-i", sourcePath, ...audioInputArgs, "-map", "0:v:0", "-map", "1:a:0",
      "-t", String(duration), "-vf", videoFilter, "-c:v", "libx264", "-preset", "fast",
      "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-shortest", "-y", outputPath,
    ], { maxBuffer: 50 * 1024 * 1024 });
  };
  const concatStudioVideos = async (inputs: string[], outputPath: string, tmpDir: string) => {
    const listPath = path.join(tmpDir, "concat.txt");
    const listContent = inputs.map((filePath) => (
      `file '${resolveSourcePath(filePath).replace(/'/g, "'\\''")}'`
    )).join("\n");
    await fs.promises.writeFile(listPath, listContent, "utf-8");
    await execFileAsync("ffmpeg", [
      "-f", "concat", "-safe", "0", "-i", listPath, "-fflags", "+genpts",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-c:a", "aac",
      "-ar", "48000", "-b:a", "192k", "-movflags", "+faststart", "-y", outputPath,
    ], { maxBuffer: 50 * 1024 * 1024 });
  };
  const burnStudioSubtitle = async (
    inputPath: string,
    outputPath: string,
    subtitleText: string,
    duration: number,
    tmpDir: string,
  ) => {
    const srtPath = path.join(tmpDir, "subtitle.srt");
    const content = `1\n${srtTime(0.2)} --> ${srtTime(Math.max(0.3, duration - 0.2))}\n${subtitleText}\n\n`;
    await fs.promises.writeFile(srtPath, content, "utf-8");
    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-vf", `subtitles='${escapeSubtitlePath(srtPath)}':force_style='FontSize=24,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,Outline=2,Alignment=2'`,
      "-c:a", "copy", "-movflags", "+faststart", "-y", outputPath,
    ], { maxBuffer: 50 * 1024 * 1024 });
  };

  ipcMain.handle("studio-render-track-candidate", async (_event, plan: TrackRenderPlan) => {
    const tmpDir = path.join(getStudioRenderRoot(), `tmp-${crypto.randomUUID()}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    try {
      await assertFfmpegAvailable();
      if (!plan.inputs.length) throw new Error("没有可渲染的 track 输入素材");
      const outputName = createStudioRenderName("track");
      const outputPath = path.join(getStudioRenderRoot(), outputName);
      const segmentPaths: string[] = [];
      for (const [index, input] of plan.inputs.entries()) {
        const segmentPath = path.join(tmpDir, `segment-${String(index + 1).padStart(3, "0")}.mp4`);
        await renderStudioSegment(input, segmentPath);
        segmentPaths.push(segmentPath);
      }
      const rawPath = path.join(tmpDir, "raw.mp4");
      if (segmentPaths.length === 1) await fs.promises.copyFile(segmentPaths[0], rawPath);
      else await concatStudioVideos(segmentPaths, rawPath, tmpDir);
      if (plan.subtitleText?.trim()) {
        await burnStudioSubtitle(rawPath, outputPath, plan.subtitleText.trim(), plan.duration, tmpDir);
      } else await fs.promises.copyFile(rawPath, outputPath);
      return { success: true, filePath: outputPath, previewUrl: `local-image://studio-render/${outputName}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  ipcMain.handle("studio-timeline-render", async (_event, plan: unknown) => getTimelineRenderRuntime().render(plan));
  ipcMain.handle("studio-timeline-render-cancel", async (_event, jobId: string) => getTimelineRenderRuntime().cancel(jobId));
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
  ipcMain.handle("studio-merge-episode", async (_event, plan: EpisodeMergePlan) => {
    const tmpDir = path.join(getStudioRenderRoot(), `tmp-${crypto.randomUUID()}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    try {
      await assertFfmpegAvailable();
      if (!plan.inputs.length) throw new Error("没有可拼接的视频输入");
      plan.inputs.forEach(ensureReadableStudioSource);
      const outputName = createStudioRenderName("episode");
      const outputPath = path.join(getStudioRenderRoot(), outputName);
      await concatStudioVideos(plan.inputs, outputPath, tmpDir);
      return { success: true, filePath: outputPath, previewUrl: `local-image://studio-render/${outputName}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  ipcMain.handle("studio-probe-media-evidence", async (_event, sourcePath: string) => {
    const resolvedPath = ensureReadableStudioSource(sourcePath);
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
  });
}
