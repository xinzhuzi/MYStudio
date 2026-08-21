import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ensureBrowser } from "@remotion/renderer";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";
import { validateVideoUseChapterArtifact } from "@rendering/contracts/video-workflow";

const execFileAsync = promisify(execFileCallback);
const PROJECT_ROOT = process.env.MYSTUDIO_FORMAL_PROJECT_ROOT?.trim()
  || "/Users/zhengbingjin/Project/IP/MA";
const USER_DATA = process.env.MYSTUDIO_FORMAL_USER_DATA?.trim()
  || "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";
const REVISION = Number(process.env.MYSTUDIO_FORMAL_REVISION);
const ELECTRON = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const WORKER = "/Applications/漫影工作室.app/Contents/Resources/app.asar.unpacked/out/main/hyperframes-worker.cjs";

async function main(): Promise<void> {
  if (!Number.isSafeInteger(REVISION) || REVISION < 1) throw new Error("MYSTUDIO_FORMAL_REVISION 必须是正整数");
  if (!fs.existsSync(WORKER)) throw new Error(`HyperFrames worker 不存在: ${WORKER}`);
  const artifactPath = path.join(PROJECT_ROOT, "video-use", CHAPTER_ID, `r${REVISION}`, "video-use-artifact.json");
  const artifactResult = validateVideoUseChapterArtifact(JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown);
  if (!artifactResult.success) throw new Error(`video-use artifact 无效: ${artifactResult.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  const artifact = artifactResult.value;
  const windows = artifact.overlaySlots.filter((slot) => slot.templateId).map((slot) => ({
    slotId: slot.slotId,
    cueId: slot.cueId,
    startUs: slot.startUs,
    durationUs: slot.durationUs,
    templateId: slot.templateId!,
    parameters: slot.parameters!,
  }));
  if (windows.length === 0) throw new Error("accepted video-use artifact 没有非文字装饰窗口");
  const outputDir = path.join(PROJECT_ROOT, "hyperframes", CHAPTER_ID, `r${REVISION}`);
  const outputPath = path.join(outputDir, "hyperframes-overlay.mov");
  if (fs.existsSync(outputPath)) throw new Error(`拒绝覆盖已存在 HyperFrames 输出: ${outputPath}`);
  const request = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    revision: REVISION,
    sourceArtifactSha256: artifact.evidence.artifactSha256,
    inputSha256: artifact.evidence.inputSha256,
    width: 1920,
    height: 1080,
    fps: 30,
    alphaFormat: "prores-4444-mov" as const,
    outputPath,
    windows,
  };
  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({
      browserExecutable: undefined,
      chromiumOptions: {},
      forceDeviceScaleFactor: undefined,
      allowFallback: true,
      onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
    } as never);
    const browserPath = (browser as unknown as { path: string }).path;
    process.env.HYPERFRAMES_BROWSER_PATH = browserPath;
    const adapter = createHyperFramesAdapter({
      storageBasePath: USER_DATA,
      electronExecutable: ELECTRON,
      workspaceRootForProject: () => path.join(PROJECT_ROOT, "hyperframes"),
      workerPath: WORKER,
      resolveBrowserPath: async () => browserPath,
      execFile: (file, args, options) => execFileAsync(process.execPath, args, {
        ...options,
        env: { ...options.env, MYSTUDIO_HYPERFRAMES_NODE: process.execPath },
      }),
    });
    const probe = await adapter.probe();
    if (probe.state !== "ready") throw new Error(`HyperFrames 运行时未就绪: ${probe.message}`);
    const result = await adapter.renderOverlay(request);
    if (result.state !== "ready") throw new Error(`HyperFrames 渲染失败: ${result.code} ${result.message}`);
    const outputStat = fs.statSync(outputPath);
    process.stdout.write(`${JSON.stringify({
      revision: REVISION,
      windows: result.artifact.windows.length,
      artifactPath: result.artifactPath,
      outputPath,
      outputBytes: outputStat.size,
      outputSha256: result.artifact.outputSha256,
      sourceArtifactSha256: result.artifact.sourceArtifactSha256,
      inputSha256: result.artifact.inputSha256,
    }, null, 2)}\n`);
  } finally {
    process.chdir(previousCwd);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
