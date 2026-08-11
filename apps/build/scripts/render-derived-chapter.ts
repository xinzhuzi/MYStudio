import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { compileTimelineRenderPlan } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/studio/editing/timeline-render-compiler";
import { validateEditingProject } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/studio/editing/validation";
import { readRemotionCurrentShotSlotsFromWorkspace } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/studio/remotion/remotion-current-slot";
import { createRemotionChapterRenderIdentity } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/renderer/remotion-chapter-renderer";
import { buildChapterVideoCompositionProps } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/composition/build-composition-props";
import { MediaBridgeServer } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { evaluateRemotionChapterGate } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/studio/video-workflow/chapter-gate";
import { createRemotionEnsureBrowserAdapters } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { validateChapterVideoCompositionProps } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/composition/composition-props-validation";
import { assertBundleMatchesRuntime } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/electron/rendering/plugins/remotion/render/bundle-manifest";
import { probeRenderedMedia, hashFileSha256 } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/build/remotion/render-smoke-evidence";

const cloneRoot = process.env.CLONE_ROOT!;
const projectId = "49dce4c1-64b1-42de-85c2-9f266698aec0";
const chapterId = "chapter-001";
const projectDir = path.join(cloneRoot, "projects", "_p", projectId);
const editingPath = path.join(process.env.ARTIFACT_DIR!, "editing-project.json");
const artifactPath = path.join(projectDir, "video-use", chapterId, "r2", "video-use-artifact.json");
const hyperFramesPath = path.join(projectDir, "video-use", chapterId, "r2", "hyperframes-artifact.json");
const outputDir = path.join(process.env.ARTIFACT_DIR!, "remotion-derived");
const outputPath = path.join(outputDir, "output.mp4");
const bundlePath = "/Users/zhengbingjin/Project/Github/MYStudio/apps/.cache/remotion-bundle";
const remotionVersion = "4.0.499";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")) as any;
const editing = validateEditingProject(readJson(editingPath));
if (!editing.success) throw new Error(editing.issues.map((issue) => issue.message).join("；"));
const compiled = compileTimelineRenderPlan(editing.value, { jobId: "derived-chapter-render", createdAt: editing.value.updatedAt });
if (!compiled.success) throw new Error(compiled.issues.map((issue) => issue.message).join("；"));
const plan = compiled.value;
const chapterManifest = readJson(path.join(projectDir, "remotion", "chapters", `${chapterId}.json`));
const videoUseArtifact = readJson(artifactPath);
const hyperFramesArtifact = readJson(hyperFramesPath);
  const gate = evaluateRemotionChapterGate({
  projectId,
  chapterId,
  revision: 2,
  inputSha256: "0".repeat(64),
  videoUseInputSha256: videoUseArtifact.evidence.inputSha256,
  videoUseArtifact,
  hyperFramesArtifact,
  });
  if (!gate.accepted) throw new Error(`${gate.code}: ${gate.message}`);
  const flatMode = gate.mode === "flat-shot-mp4";
  const workspaceRoot = path.join(projectDir, "remotion");
const currentShotSlots = await readRemotionCurrentShotSlotsFromWorkspace(workspaceRoot, projectId, chapterId);
const manifest = assertBundleMatchesRuntime(readJson(path.join(bundlePath, "manifest.json")), remotionVersion);
const identity = await createRemotionChapterRenderIdentity({ plan, currentShotSlots, chapterManifest, bundleContentHash: manifest.contentHash });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const browser = await createRemotionEnsureBrowserAdapters(ensureBrowser as any).probe.ensureBrowser({ onDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } });
if (!browser.executablePath) throw new Error("缺少 Headless Shell");
const bridge = new MediaBridgeServer();
await bridge.listen();
const session = bridge.createSession();
try {
  const visualClips = plan.clips.filter((clip) => clip.trackKind === "video" || clip.trackKind === "image");
  const sources = visualClips.map((clip) => {
    if (flatMode) {
      const sourcePath = clip.source.path;
      if (!sourcePath || !path.isAbsolute(sourcePath) || !gate.videoUseFlatShotMp4Path || sourcePath !== gate.videoUseFlatShotMp4Path) {
        throw new Error(`flat-shot-mp4 visual source 与 gate clean MP4 不一致: ${clip.id}`);
      }
      return { clipId: clip.id, absolutePath: sourcePath };
    }
    const shotId = clip.source.evidence.storyboardId;
    const slot = currentShotSlots.find((candidate) => candidate.target.kind === "shot" && candidate.target.shotId === shotId);
    if (!slot || slot.target.kind !== "shot") throw new Error(`缺少 slot: ${shotId}`);
    const sourcePath = clip.source.path && path.isAbsolute(clip.source.path)
      ? clip.source.path
      : path.join(workspaceRoot, slot.outputPath);
    return { clipId: clip.id, absolutePath: sourcePath };
  });
  const currentShotSlotPaths = Object.fromEntries(
    currentShotSlots
      .filter((slot) => slot.target.kind === "shot")
      .map((slot) => [slot.target.shotId, path.join(workspaceRoot, slot.outputPath)]),
  );
  const urls = buildMediaUrlMap(bridge, session, sources);
  const propsResult = buildChapterVideoCompositionProps({
    plan,
    currentShotSlots,
    chapterManifest,
    currentShotSlotPaths,
    videoWorkflowGate: gate,
    mediaUrlByClipId: urls,
    mediaUrlByBindingId: {},
  });
  if (!propsResult.success) throw new Error(propsResult.issues.map((issue) => issue.message).join("；"));
  const props = validateChapterVideoCompositionProps(propsResult.value);
  if (!props.success) throw new Error(props.issues.map((issue) => issue.message).join("；"));
  await fs.promises.mkdir(outputDir, { recursive: true });
  const composition = await selectComposition({
    serveUrl: bundlePath,
    id: "ChapterVideo",
    inputProps: props.value,
    browserExecutable: browser.executablePath,
    binariesDirectory: "/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/@remotion/compositor-darwin-arm64",
    chromeMode: "headless-shell",
    onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
  });
  await renderMedia({
    serveUrl: bundlePath,
    composition,
    inputProps: props.value,
    outputLocation: outputPath,
    codec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    browserExecutable: browser.executablePath,
    binariesDirectory: "/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/@remotion/compositor-darwin-arm64",
    chromeMode: "headless-shell",
    enforceAudioTrack: true,
    overwrite: true,
    onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
  });
  const probe = await probeRenderedMedia(outputPath);
  const stat = await fs.promises.stat(outputPath);
  const sha256 = await hashFileSha256(outputPath);
  const evidence = {
    schemaVersion: 1,
    projectId,
    target: { kind: "chapter", chapterId, editingProjectId: plan.editingProjectId, editingRevision: plan.editingRevision },
    inputHash: identity.inputHash,
    bundleContentHash: manifest.contentHash,
    renderSettingsHash: identity.renderSettingsHash,
    jobId: identity.jobId,
    templateVersion: manifest.templateVersion,
    remotionVersion,
    attempt: 1,
    compositionId: "ChapterVideo",
    renderer: { requested: "remotion", actual: "remotion" },
    path: outputPath,
    outputPath,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256,
    duration: probe.duration,
    durationUs: Math.round(probe.duration * 1_000_000),
    width: probe.width,
    height: probe.height,
    streams: probe.raw.streams ?? [],
    snapshotHash: await hashFileSha256(editingPath),
    snapshotPath: editingPath,
    completedAt: Date.now(),
  };
  fs.writeFileSync(path.join(outputDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "expected.json"), `${JSON.stringify({ projectId, chapterId, revision: 2, mode: gate.mode, inputSha256: identity.inputHash, videoUseInputSha256: videoUseArtifact.evidence.inputSha256, width: probe.width, height: probe.height, durationS: probe.duration, fps: plan.renderSettings.fps }, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, evidencePath: path.join(outputDir, "evidence.json"), expectedPath: path.join(outputDir, "expected.json"), inputHash: identity.inputHash, duration: probe.duration, sha256 }, null, 2));
} finally {
  await bridge.revokeSession(session);
}
