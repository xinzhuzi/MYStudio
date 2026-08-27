/**
 * 双帧样片渲染(Trellis 08-27 keyframe-sequence M2 人审看片物料)。
 *
 * 合成 plan(旧1+旧2 两张真 4K 图作关键帧)→ 生产投影 projectStoryboardShotCompositionProps
 * → 真渲染链(bundle+MediaBridge+renderMedia)→ 样片 MP4 + 报告。
 * **不读 store、不写章节 manifest、不发布 current slot**——看片物料专用,
 * 不触碰人审闸门。正式回接走分镜面板「回接旧镜图」人工确认。
 *
 * 运行: MYSTUDIO_KEYFRAME_SAMPLE=1 vite-node --config build/timeline/vite-node.config.ts build/remotion/render-keyframe-sample.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { projectStoryboardShotCompositionProps } from "@/lib/studio/remotion/shot-plan";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import type { ProjectMediaReference, RemotionShotPlanV1 } from "@/types/remotion-workspace";
import { STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import { assertBundleMatchesRuntime, type RemotionBundleManifest } from "@rendering/plugins/remotion/render/bundle-manifest";
import { buildRemotionRuntimeManifest } from "@rendering/plugins/remotion/browser/remotion-runtime-manifest";
import { createRemotionEnsureBrowserAdapters, type RemotionEnsureBrowser } from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import { probeRenderedMedia } from "./render-smoke-evidence";
import { resolveProjectDir, resolveUserDataDir } from "../timeline/storage-paths";

const remotionVersion = "4.0.499";
const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);

async function sha256File(filePath: string): Promise<string> {
  return crypto.createHash("sha256").update(await fs.promises.readFile(filePath)).digest("hex");
}

export async function renderKeyframeSample(): Promise<void> {
  // 外部位置项目(道劫=IP/MA)必须显式给 MYSTUDIO_PROJECT_DIR——离线 CLI 的
  // 注册表回退会落到 AppSupport/_p 猜测根(样片首跑实证 ENOENT)
  const projectDir = process.env.MYSTUDIO_PROJECT_DIR?.trim()
    ? path.resolve(process.env.MYSTUDIO_PROJECT_DIR)
    : resolveProjectDir();
  const projectId = "49dce4c1-64b1-42de-85c2-9f266698aec4";
  const chapterId = "chapter-001";
  const remotionRoot = path.join(projectDir, "remotion");
  const sampleDir = path.join(remotionRoot, "samples", "keyframe-demo");
  await fs.promises.mkdir(sampleDir, { recursive: true });

  // 样本帧 = 回接报告 S1 高置信双帧(旧1+旧2 的真 4K 成图)
  const frameSources = [
    "workflow-images/chapter-001/image-flow-1787411631584-ad270t/gen-gen-1787411631584-zncic7-%E5%88%86%E9%95%9C-1-%E6%88%90%E5%9B%BE-1787535904783-qv5axu.png",
    "workflow-images/chapter-001/image-flow-1787413923591-go8qup/gen-gen-1787413923592-if07eo-%E5%88%86%E9%95%9C-2-%E6%88%90%E5%9B%BE-1787537055575-dltk5r.png",
  ];
  const references: ProjectMediaReference[] = [];
  for (let index = 0; index < frameSources.length; index += 1) {
    // 样本输入直接按项目根拼(回接 mapping 的相对路径即项目内路径)
    const sourceAbs = path.join(projectDir, decodeURIComponent(frameSources[index]!));
    const sampleName = `kf-${index + 1}.png`;
    await fs.promises.copyFile(sourceAbs, path.join(sampleDir, sampleName));
    references.push({
      kind: "project-file",
      projectId,
      relativePath: `samples/keyframe-demo/${sampleName}`,
      contentSha256: await sha256File(path.join(sampleDir, sampleName)),
      provenance: { sourceKind: "storyboard", sourceId: "keyframe-sample", origin: "cli" },
    } as ProjectMediaReference);
  }

  const durationUs = 8_000_000;
  const plan: RemotionShotPlanV1 = {
    schemaVersion: 1,
    target: "shot",
    projectId,
    chapterId,
    chapterRevision: 999,
    sourceSnapshotHash: "keyframe-sample",
    renderSettings: { ...DEFAULT_REMOTION_RENDER_SETTINGS },
    visualKind: "image",
    shot: {
      shotId: "keyframe-sample-demo",
      storyboardId: "keyframe-sample-demo",
      index: 1,
      revision: 1,
      sourceFingerprint: references[0]!.contentSha256,
      durationUs,
      visualSource: references[0]!,
      keyframes: [
        { frameId: "keyframe-sample-demo-kf-1", inUs: 0, source: references[0]! },
        { frameId: "keyframe-sample-demo-kf-2", inUs: 4_000_000, source: references[1]! },
      ],
      audioBindings: [],
      motion: { kind: "static" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    },
    inputHash: "keyframe-sample",
  };

  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(appsRoot, ".cache", "remotion-bundle"));
  const manifest: RemotionBundleManifest = assertBundleMatchesRuntime(
    JSON.parse(await fs.promises.readFile(path.join(bundlePath, "manifest.json"), "utf8")),
    remotionVersion,
  );
  const runtimeDir = path.join(resolveUserDataDir(), "remotion-runtime");
  await fs.promises.mkdir(runtimeDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(runtimeDir, "package.json"),
    `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`,
    "utf8",
  );

  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  const bridge = new MediaBridgeServer();
  await bridge.listen();
  const session = bridge.createSession();
  try {
    const browser = await createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser)
      .probe.ensureBrowser({ onDownload: () => { throw new Error("Remotion Headless Shell 未安装"); } });
    const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
    const key = (reference: ProjectMediaReference) => `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`;
    const sources = [plan.shot.visualSource, ...(plan.shot.keyframes ?? []).map((frame) => frame.source)]
      .filter((reference, index, list) => list.findIndex((candidate) => key(candidate) === key(reference)) === index)
      .map((reference) => ({
        clipId: key(reference),
        absolutePath: path.join(remotionRoot, reference.relativePath),
      }));
    const urls = buildMediaUrlMap(bridge, session, sources);
    const props = projectStoryboardShotCompositionProps(plan, (reference) => {
      const url = urls[key(reference)];
      if (!url) throw new Error(`样片 capability 缺失: ${reference.relativePath}`);
      return url;
    });
    if (!props.success) throw new Error(props.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));

    const composition = await selectComposition({
      serveUrl: bundlePath, id: STORYBOARD_SHOT_COMPOSITION_ID, inputProps: props.value,
      browserExecutable: browser.executablePath, binariesDirectory, chromeMode: "headless-shell",
      onBrowserDownload: () => { throw new Error("禁止隐式下载"); },
    });
    const outputPath = path.join(appsRoot, "output", "automation", "keyframe-sample.mp4");
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await renderMedia({
      serveUrl: bundlePath, composition, inputProps: props.value, outputLocation: outputPath,
      codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac",
      browserExecutable: browser.executablePath, binariesDirectory, chromeMode: "headless-shell",
      enforceAudioTrack: true, overwrite: true,
      onBrowserDownload: () => { throw new Error("禁止隐式下载"); },
    });
    const probe = await probeRenderedMedia(outputPath);
    const report = {
      ok: true,
      bundleVersion: manifest.contentHash,
      output: outputPath,
      durationSeconds: Number(probe.duration.toFixed(2)),
      visualClips: props.value.visualClips.map((clip) => ({ clipId: clip.clipId, from: clip.from, durationInFrames: clip.durationInFrames })),
      transitions: props.value.transitions,
      frames: references.map((reference) => ({ relativePath: reference.relativePath, sha256: reference.contentSha256.slice(0, 12) })),
    };
    const reportPath = path.join(appsRoot, "output", "automation", "keyframe-sample-report.json");
    await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`样片完成: ${outputPath} (${report.durationSeconds}s)`);
    console.log(`clip/转场布局: ${JSON.stringify({ clips: report.visualClips, transitions: report.transitions })}`);
  } finally {
    await bridge.revokeSession(session).catch(() => undefined);
    await bridge.close().catch(() => undefined);
    process.chdir(previousCwd);
  }
}

if (process.env.MYSTUDIO_KEYFRAME_SAMPLE === "1") {
  void renderKeyframeSample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
