// 分镜批量生成的单镜生成引擎(缺帧判定、来源变更守卫、VLM 审查、单镜生成、生成与回写)。2026-11-24 超线文件拆分:从 use-storyboard-batch-generation.ts 拆出;钩子与状态留在原文件,对外导出不变。

import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { buildStoryboardImageWorkflowPatch } from "@/lib/studio/image-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { storyboardSourceFingerprint, storyboardSourceFingerprintDrifted } from "@/stores/studio/studio-store-continuity-helpers";
import { visualReviewInputFingerprint } from "@/lib/studio/visual-continuity";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import { buildStoryboardItemOpenContext } from "../storyboard-open-context";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import { buildStoryboardCanonicalContext } from "./storyboard-canonical-context";
import {
  createOpenImageWorkflowGraph,
  ensureStoryboardAssetReferences,
  findStoryboardWorkflowForContext,
  migrateStoryboardPromptToCanonical,
  resolveOpenContextGeneratedNodeId,
  stripStoryboardPromptStyleWords,
} from "./image-workflow-graph-utils";
import { ensureStoryboardSceneAssetsLanded } from "./storyboard-scene-landing";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";
import { landStoryboardContinuity } from "./land-continuity";

/**
 * L2(11-15 断点②):建流/补挂期「本期参考数」入 diagnostics——场景/角色/道具
 * 分桶计数+未挂名单(请求清单 ∖ 挂载集,双向包含口径容复合资产名)。解析器
 * (storyboard-asset-references)对 fail-empty 另记 warn,双痕互证;实弹期首镜
 * 看本痕即可定谳「链通/桥 fail-empty/名称 miss/道具缺发」(FR3-L2diag)。
 */
export function logStoryboardReferenceBudget(
  shot: StoryboardItem,
  references: NonNullable<ImageWorkflowOpenContext["assetReferences"]>,
): void {
  const requested = shot.associateAssetsNames ?? [];
  if (!requested.length) return;
  const attached = references.map((ref) => ref.title);
  const unresolvedNames = requested.filter((name) =>
    !attached.some((title) => title.includes(name) || name.includes(title)));
  const countBy = (assetType: "scene" | "character" | "prop") =>
    references.filter((ref) => ref.assetType === assetType).length;
  void logEvent({
    level: references.length ? "info" : "warn",
    category: "workflow",
    operationId: createOperationId("storyboard-ref-budget"),
    message: references.length
      ? `Storyboard reference budget: scene=${countBy("scene")} character=${countBy("character")} prop=${countBy("prop")}`
      : "Storyboard reference budget: empty (no asset references attached)",
    context: {
      shotId: shot.id,
      shotIndex: shot.index,
      requested: requested.length,
      attachedScene: countBy("scene"),
      attachedCharacter: countBy("character"),
      attachedProp: countBy("prop"),
      unresolvedNames,
    },
  });
}

/** M3a:缺帧计数——单帧镜无图=1;多帧镜=空槽帧数(mediaRef 缺图视为首帧空)。
 * W2(1112 验尸 .trellis/tasks/11-12-storyboard-asset-refchain-repair):stale 或
 * 「脏而未标」(存档指纹≠现算指纹——离线 CLI 直写改文本不走 merge 链不置脏)
 * 的已有图镜也计缺帧纳入批量,斩断脏镜被当新鲜跳过的 media 冻结。
 * 1120 件二修复:video mediaRef(验收主口径)=终态画面,不计缺帧——旧判定
 * (非 image 恒计 1)在主口径转 video 后首造「已出视频镜每轮批量重烧图+落账
 * 把 mediaRef 覆盖回 image→videoReady 倒退/全绿翻转」;视频镜的静图仍在
 * 工作流/物料库,单镜 force 重出不受本过滤影响(shotForce 绕过)。 */
export function countMissingFrames(shot: StoryboardItem): number {
  if (!shot.keyframes?.length) {
    if (shot.mediaRef?.kind === "video" && shot.mediaRef.path) return 0;
    if (!(shot.mediaRef?.kind === "image" && shot.mediaRef.path)) return 1;
    return shot.stale || storyboardSourceFingerprintDrifted(shot) ? 1 : 0;
  }
  return shot.keyframes.filter((frame) => frameNeedsGeneration(shot, frame)).length;
}

/** 需批量生成的镜数(1116 四散件③):分镜面板一键生图按钮的显隐计数——与批量
 *  执行队列同源(countMissingFrames>0 同一谓词)。此前面板按「无图镜数」判
 *  (ordered.length - withImage),批量真门却把 stale/指纹漂移的已有图镜也纳入
 *  →stale 态钮隐=两门错位(一键生图判 0 缺全跳同根)。 */
export function countShotsNeedingBatchGeneration(shots: StoryboardItem[]): number {
  return shots.filter((shot) => countMissingFrames(shot) > 0).length;
}

/** stale 的旧 URI 不算完成;同一失效时点之后、同源工作流的已落帧可续跑。
 * W2:指纹漂移(脏而未标)与 stale 同门——漂移镜没有失效时点,既有帧全部重生成。 */
export function frameNeedsGeneration(shot: StoryboardItem, frame: NonNullable<StoryboardItem["keyframes"]>[number]): boolean {
  if (!frame.mediaRef?.path) return true;
  if (!shot.stale && !storyboardSourceFingerprintDrifted(shot)) return false;
  if (!shot.staleSince) return true;
  const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === frame.mediaRef.imageWorkflowId);
  const node = graph?.nodes.find((item) => item.id === frame.mediaRef.imageWorkflowNodeId);
  return !(graph?.target.kind === "storyboard" && graph.target.id === shot.id
    && graph.targetSourceFingerprint === (shot.sourceFingerprint ?? storyboardSourceFingerprint(shot))
    && node?.type === "generated" && node.resultUrl === frame.mediaRef.path
    && typeof node.generatedAt === "number" && node.generatedAt >= shot.staleSince
    && frame.origin?.kind === "generated");
}

/** 恢复后零缺帧也必须收敛失效标记；生成来源证据不代表人工批准。 */
export function finalizeRecoveredShot(shot: StoryboardItem) {
  const current = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
  if (current?.stale && current.keyframes?.length && countMissingFrames(current) === 0) {
    useStudioStore.getState().updateStoryboard(current.id, {
      stale: false, staleSince: undefined, staleReason: undefined,
    });
  }
}

export class BatchSourceChangedError extends Error {}

/** 只有本批次明确包裹的同步写入才能推进预期；异步生成/审核期间绝不重置快照。 */
export function createBatchSourceGuards(shots: StoryboardItem[]) {
  const guards = new Map<string, ReturnType<typeof createBatchSourceGuard>>();
  const write = (run: () => void) => {
    for (const guard of guards.values()) guard.assertCurrent();
    run();
    for (const guard of guards.values()) guard.acceptSynchronousWrite();
  };
  for (const shot of shots) guards.set(shot.id, createBatchSourceGuard(shot, write));
  return guards;
}

export function createBatchSourceGuard(shot: StoryboardItem, write: (run: () => void) => void) {
  const projectId = useProjectStore.getState().activeProjectId;
  const initial = useStudioStore.getState();
  const chapterId = initial.activeChapterId;
  const upstream = () => {
    const store = useStudioStore.getState();
    return JSON.stringify([
      store.novelChapters.find((chapter) => chapter.id === shot.episodeId),
      store.scriptPlans.filter((plan) => plan.episodeId === shot.episodeId),
      store.agentWorkData.filter((work) => work.episodeId === shot.episodeId),
      store.sourceBible, store.seriesBible, store.continuityAssetVersions,
    ]);
  };
  const upstreamVersion = upstream();
  const fingerprint = (item: StoryboardItem) => JSON.stringify([
    storyboardSourceFingerprint(item), item.sourceRunId, item.sourceId, item.revision,
    item.stale, item.staleSince, item.staleReason, visualReviewInputFingerprint(item),
    item.keyframes?.map(({ frameId, inUs, momentDescription }) => ({ frameId, inUs, momentDescription })),
  ]);
  const dependencies = () => {
    const store = useStudioStore.getState();
    const current = store.storyboards.find((item) => item.id === shot.id);
    return JSON.stringify(store.storyboards.filter((item) => item.episodeId === shot.episodeId
      && (item.id === current?.continuityState?.previousStoryboardId
        || (current?.continuityState?.groupId && item.index < current.index
          && item.continuityState?.groupId === current.continuityState.groupId)))
      .map((item) => [item.id, fingerprint(item)]));
  };
  let expected = fingerprint(shot);
  let expectedDependencies = dependencies();
  return {
    write,
    assertCurrent() {
      const store = useStudioStore.getState();
      const current = store.storyboards.find((item) => item.id === shot.id);
      if (useProjectStore.getState().activeProjectId !== projectId
        || store.activeChapterId !== chapterId || store.chapterSwitchLoading
        || !current || current.episodeId !== shot.episodeId || fingerprint(current) !== expected
        || dependencies() !== expectedDependencies
        || upstream() !== upstreamVersion) {
        throw new BatchSourceChangedError(`项目、章节或分镜来源已变化，已停止旧批次写回 (${!current ? "missing" : fingerprint(current) !== expected ? "shot" : upstream() !== upstreamVersion ? "upstream" : "scope"})`);
      }
    },
    acceptSynchronousWrite() {
      const current = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
      if (current) expected = fingerprint(current);
      expectedDependencies = dependencies();
    },
  };
}

/** VLM 视觉一致性审核:成图 vs 资产参考图(fail-open,模型未装=null 跳过)。 */
export async function reviewFrame(
  imageUrl: string,
  shot: StoryboardItem,
): Promise<VlmReviewArtifactV1 | null> {
  const bridge = typeof window !== "undefined" ? window.vlmReview : undefined;
  // 1118 二十一刀:静默 return null=黑灯裸奔(1117 晚起 Mac 无权重,19 帧
  // 零审入库,8 克隆废片实录)——bridge 缺席/未就绪一律落 warn 可见。
  if (!bridge?.run) {
    void logEvent({
      level: "warn", category: "ai",
      operationId: createOperationId("vlm-review-blackout"),
      message: "VLM 审核黑灯(bridge 缺席),本帧未审直接放行",
      context: { shotId: shot.id },
    });
    return null;
  }
  try {
    const probe = await bridge.probe();
    if (probe.status !== "ready") {
      void logEvent({
        level: "warn", category: "ai",
        operationId: createOperationId("vlm-review-blackout"),
        message: "VLM 审核未就绪(模型/运行时缺),本帧未审直接放行",
        context: { shotId: shot.id, code: probe.code ?? null },
      });
      return null;
    }
    const referenceImages = (shot.orderedReferenceManifest ?? [])
      .filter((ref) => ref.imagePath)
      .map((ref) => ({
        path: ref.imagePath!,
        role: ((ref.assetKind as string) ?? "character") as "scene" | "character" | "prop",
        assetName: ref.assetName ?? ref.assetId,
      }));
    // 1117 第十三刀B:零参考不再静默跳过——九刀单角色镜弃参考后无参考可审,
    // 21:07 批 8/19 克隆直进成品实录;worker 零参考模式跑克隆/文字/噪点三项
    // (身份比对仍属盲区,uncovered 留痕照旧)。
    const artifact = await bridge.run({
      schemaVersion: 1,
      projectId: useProjectStore.getState().activeProjectId ?? "unknown",
      shotId: shot.id,
      generatedImagePath: imageUrl,
      referenceImages,
      expectedContent: shot.videoDesc || shot.prompt || "",
      expectedCharacters: shot.associateAssetsNames ?? [],
    });
    // R20 盲区可视化(08-28):VLM 只查「挂了参考的角色」,无参考角色(群演/孩童/
    // 妇人等无资产条目者)静默放行。计算未覆盖名单写入工件随 vlmReview 落库
    // (审核面板可见)+ diagnostics 留痕——不改 fail-open 语义,只把盲区变可见。
    const uncoveredCharacters = (shot.associateAssetsNames ?? []).filter(
      (name) => name && !referenceImages.some((ref) => {
        const refName = ref.assetName ?? "";
        return refName.includes(name) || name.includes(refName.split(/[;；]/)[0] ?? "");
      }),
    );
    if (uncoveredCharacters.length > 0) {
      void logEvent({
        level: "warn",
        category: "ai",
        operationId: createOperationId("vlm-review-uncovered"),
        message: "VLM 审核存在无参考角色盲区(该角色不在校验范围)",
        context: { shotId: shot.id, uncoveredCharacters },
      });
    }
    return { ...artifact, uncoveredCharacters };
  } catch {
    return null;
  }
}

export const VLM_MAX_RETRIES = 1;

/** 生成+VLM审核循环:通过=返回 / rejected=重生一次 / 两次rejected=抛错。 */
export async function generateWithVlmReview(
  graph: NonNullable<ReturnType<typeof findStoryboardWorkflowForContext>>,
  targetNodeId: string,
  shot: StoryboardItem,
  opts: {
    addMaterial: ReturnType<typeof useStudioStore.getState>["addMaterial"];
    /** 失败回退阶梯第三段:降载降分辨率(缺省=不降)。 */
    degradedResolution?: string;
    guard: ReturnType<typeof createBatchSourceGuard>;
  },
): Promise<{ imageUrl: string; vlmStatus: string | null; vlmArtifact?: VlmReviewArtifactV1 }> {
  for (let attempt = 0; attempt <= VLM_MAX_RETRIES; attempt++) {
    opts.guard.assertCurrent();
    const staleSelfReferences = new Set(shot.stale ? graph.nodes
      .filter((node) => node.type === "reference" && node.source?.kind === "storyboard" && node.source.id === shot.id)
      .map((node) => node.id) : []);
    const generationGraph = staleSelfReferences.size
      ? { ...graph, edges: graph.edges.filter((edge) => !staleSelfReferences.has(edge.source)) }
      : graph;
    const { imageUrl } = await runImageWorkflowNodeGeneration(generationGraph, targetNodeId, {
      addMaterial: (material) => {
        opts.guard.assertCurrent();
        return opts.addMaterial(material);
      },
      degradedResolution: opts.degradedResolution,
      assertStillCurrent: opts.guard.assertCurrent,
      // 1117 第十三刀B:批量链产后审核走本件 reviewFrame(预审+重生梯),
      // 跳过节点级闸门防同一张图双跑 VLM。
      skipCharacterGate: true,
    });
    opts.guard.assertCurrent();
    if (!imageUrl) throw new Error("生成结果为空");
    const artifact = await reviewFrame(imageUrl, shot);
    opts.guard.assertCurrent();
    if (!artifact || artifact.status !== "rejected") {
      return { imageUrl, vlmStatus: artifact?.status ?? null, vlmArtifact: artifact ?? undefined };
    }
    if (attempt === VLM_MAX_RETRIES) {
      throw new Error(`VLM 审核不通过:${(artifact.reasons ?? []).join(";").slice(0, 120)}`);
    }
  }
  throw new Error("VLM 审核不通过");
}

/**
 * 单镜执行:找既有分镜工作流(打开链同口径匹配)→无则全装配建流→生图→回写分镜。
 * M3a 多帧:按 frameId 序逐帧串行生成(帧间链 gen(k-1)→gen(k) 自动喂上一帧
 * 成图作连贯参考),每帧即时回写 keyframes(reason="generate");单帧镜走原路径。
 */
export async function generateOneShot(
  shot: StoryboardItem,
  projectName: string,
  hooks?: {
    onFrameStart?: (label: string) => void;
  /** 1117 残项④:帧粒度完成回调(单帧镜与多帧镜每帧毕各一次)——面板/日志
   *  done 逐帧可观测(整镜聚合 done+= 保留,终态对账不變)。 */
  onFrameDone?: (label: string) => void;
    /** 失败回退阶梯第三段:降载降分辨率(缺省=不降)。 */
    degradedResolution?: string;
    /** 全量重出(1116):绕过 frameNeedsGeneration 过滤,多帧镜全部帧重生成。 */
    forceRegenerate?: boolean;
    guard: ReturnType<typeof createBatchSourceGuard>;
  },
): Promise<void> {
  const guard = hooks!.guard;
  guard.assertCurrent();
  shot = useStudioStore.getState().storyboards.find((item) => item.id === shot.id)!;
  const emptyFrames = hooks?.forceRegenerate
    ? (shot.keyframes ?? [])
    : (shot.keyframes ?? []).filter((frame) => frameNeedsGeneration(shot, frame));
  if (shot.keyframes?.length && emptyFrames.length === 0) {
    guard.write(() => finalizeRecoveredShot(shot));
    return;
  }
  if (shot.stale && !shot.staleSince) {
    guard.write(() => useStudioStore.getState().updateStoryboard(shot.id, { staleSince: Date.now() }));
    shot = useStudioStore.getState().storyboards.find((item) => item.id === shot.id)!;
  }
  const context = buildStoryboardItemOpenContext({ ...shot, mediaRef: shot.stale ? undefined : shot.mediaRef });
  const store = useStudioStore.getState();
  // scene 落地驱动(1116,PRD §五.5):分镜关联场景走产品正路入库/出图
  // (storeRowInAssetLibrary 同款 assets:add / generateAsset→收尾入库),禁直写
  // SQLite;幂等(库内已有图零动作),fail-open 不阻断生图主链。
  // 1117 C2 G5②:衍生资产落地管道(导演规划⑦清单→assets:add 只建行不烧卡,
  // 幂等 fail-open)同点 pre-flight——0 衍生行缺口在此闭环。
  await ensureStoryboardSceneAssetsLanded(shot);
  // G5② 衍生落地(自身 fail-open):部分模块形(仅桩化场景落地的旧形测试床)
  // 无该导出,缺席=跳过,不断生图主链。
  try {
    const sceneLanding = await import("./storyboard-scene-landing");
    await sceneLanding.ensureStoryboardDerivedAssetsLanded?.(shot);
  } catch {
    // fail-open:衍生落行缺位不阻断分镜生图
  }
  guard.assertCurrent();
  // 1116 换线正典:主体句=生成器五项序产出(§4.1-4.2),建流/迁移共用同源产物。
  const canonical = await buildStoryboardCanonicalContext(shot);
  guard.assertCurrent();
  // 身份防线:择优复用(有参考节点的旧代/新代并存时优先带参考者),
  // 选中者无参考而分镜带资产清单→重解析补挂(S08 实证:空参考会让
  // 模型自由发挥角色形象,监工被画成主角剑客相)
  let graph = findStoryboardWorkflowForContext(store.imageWorkflows, context);
  if (!graph) {
    const assetReferences = (await resolveStoryboardAssetReferences(shot).catch(() => [])) ?? [];
    logStoryboardReferenceBudget(shot, assetReferences);
    guard.assertCurrent();
    graph = createOpenImageWorkflowGraph({ ...context, assetReferences, canonicalSubject: canonical.sentence.text }, projectName);
    useStudioStore.getState().upsertImageWorkflow(graph);
  } else {
    // L3(11-15 断点③):补挂门改资产维度——旧门「图内零任意 reference 才补挂」
    // 让带杂参考(当前分镜参考图/分镜帧/手动 project-file)而零资产参考的图
    // 永久粘死;现判「图内零 source.kind==='asset' 参考节点」,集差/替换语义
    // 在 ensureStoryboardAssetReferences 内(杂参考保留,资产参考集对齐现镜)。
    // 1120 单镜重出实弹勘误:门改「恒对齐」——重用图里资产参考节点可能持陈旧
    // imageUrl(资产图换代后),槽位图∉当轮来源集=传输血缘门拒发(镜3 实录:
    // 42角色标准化役换图后重出秒拒);ensure 幂等(对齐=零改动),新流零涟漪。
    {
      const references = (await resolveStoryboardAssetReferences(shot).catch(() => [])) ?? [];
      logStoryboardReferenceBudget(shot, references);
      guard.assertCurrent();
      const ensured = ensureStoryboardAssetReferences(graph, references);
      if (ensured !== graph) {
        useStudioStore.getState().upsertImageWorkflow(ensured);
        graph = ensured;
      }
    }
    // 1116 换线:存量流(手册装配体/@图N 头段)提示词迁移到正典主体句+盖戳;
    // 幂等(基准段一致零改动),【本帧时刻】帧差异后缀逐字保留。
    const migrated = migrateStoryboardPromptToCanonical(graph, canonical.sentence.text);
    if (migrated !== graph) {
      useStudioStore.getState().upsertImageWorkflow(migrated);
      graph = migrated;
    }
  }
  const targetNodeId = resolveOpenContextGeneratedNodeId(graph, context)
    ?? graph.nodes.find((node) => node.type === "generated")?.id;
  if (!targetNodeId) {
    throw new Error("工作流缺少成图节点");
  }
  // 1115 A 裁补(图级,双保险):新流/复用流统一在生成前把图内 prompt 节点按
  // 门禁同源词表剥净——复用流提交实证走图内存量值(传输位剥不到),不剥则
  // 6:4011 门禁按图内旧文拒收(S08/S11 三梯实证)。
  {
    const strippedGraph = stripStoryboardPromptStyleWords(graph);
    if (strippedGraph !== graph) {
      useStudioStore.getState().upsertImageWorkflow(strippedGraph);
      graph = strippedGraph;
    }
  }
  // M3a 多帧:按帧串行生成并逐帧回写;帧间链要求顺序执行,中途失败抛错由批次层记录
  if (emptyFrames.length > 0) {
    for (const frame of emptyFrames) {
      hooks?.onFrameStart?.(`S${String(shot.index).padStart(2, "0")}-${frame.frameId.slice(-3)}`);
      const frameNodeId = graph.nodes.find(
        (node) => node.type === "generated" && (node as { frameId?: string }).frameId === frame.frameId,
      )?.id ?? (shot.keyframes?.length === 1 ? targetNodeId : undefined);
      if (!frameNodeId) {
        throw new Error(`工作流缺少帧节点 ${frame.frameId}(请重新进入该镜图片工作流建流)`);
      }
      await runFrameGenerationAndWriteback(graph, shot, frame, frameNodeId, guard, hooks?.degradedResolution);
      graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph!.id) ?? graph;
      hooks?.onFrameDone?.(`S${String(shot.index).padStart(2, "0")}-${frame.frameId.slice(-3)}`);
    }
    return;
  }
  // 生成前预检(不烧配额,08-24 装配门禁链收口): ①file:// 参考探活——经资产桥
  // 轻读一次(读完即弃,不驻留 data: 防 OOM),断链(资产改名/文件损坏)在装配后
  // 秒级可见,而非生成中「参考图无法解码」烧一次等待;②长度门前置——正文超
  // 1600 直接拒,提示精炼而非让编译器在网络前才拦
  const assetBridge = getStudioAssetsBridge();
  for (const node of graph.nodes) {
    if (node.type !== "reference") continue;
    const url = node.imageUrl ?? "";
    const assetId = node.source?.kind === "asset" ? node.source.id : undefined;
    if (!url.startsWith("file://") || !assetId || !assetBridge?.readImageDataUrl) continue;
    const alive = await assetBridge.readImageDataUrl(assetId).then(() => true).catch(() => false);
    if (!alive) {
      throw new Error(`参考图[${node.title ?? "未命名"}]无法读取(资产可能已改名或损坏),请重建参考`);
    }
  }
  const promptLength = graph.nodes.find((node) => node.type === "prompt")?.prompt?.length ?? 0;
  if (promptLength > 1600) {
    throw new Error(`提示词 ${promptLength} 字符超 1600 正文门,需精炼后再生成`);
  }
  const { imageUrl, vlmArtifact } = await generateWithVlmReview(graph, targetNodeId, shot, {
    addMaterial: useStudioStore.getState().addMaterial,
    degradedResolution: hooks?.degradedResolution,
    guard,
  });
  hooks?.onFrameDone?.(`S${String(shot.index).padStart(2, "0")}-main`);
  if (!imageUrl) throw new Error("生成结果为空");
  guard.assertCurrent();
  // 分镜回写:核心函数已 upsert 含 resultUrl 的最新代图,直接组 patch
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  // 连续性接线(方案 2):媒体落库前先落三件套,图的 freshWrite 会顺带清
  // sourceChanged 的 stale 标记;前置不满足时静默跳过,不阻塞生图主链
  guard.write(() => {
    landStoryboardContinuity(shot.id, latest.id, targetNodeId);
    const patch = buildStoryboardImageWorkflowPatch(latest, targetNodeId);
    // 1120 件二修复:已出视频镜(video mediaRef=验收主口径,与 storyboardHasVideo
    // 同判据)不被图落账覆盖回 image——旧覆盖使 videoReady 倒退/已全绿章翻回
    // 未全绿(e97159b9 主口径后首爆);静图仍落工作流节点与物料库,镜级指针
    // 保持 video(视频产出由 H3 链/videoCandidates 台账自有回路,本层禁碰)。
    const liveShot = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
    const mediaSafePatch = liveShot?.mediaRef?.kind === "video" && liveShot.mediaRef.path
      ? {
          imageWorkflowId: patch.imageWorkflowId,
          imageWorkflowNodeId: patch.imageWorkflowNodeId,
          state: patch.state,
        }
      : patch;
    useStudioStore.getState().updateStoryboard(shot.id, mediaSafePatch);
    if (vlmArtifact) useStudioStore.getState().writeStoryboardVlmReview(shot.id, {
      ...vlmArtifact,
      generatedAt: vlmArtifact.generatedAt || Date.now(),
    }, imageUrl);
  });
}

/** M3a:单帧生成+回写(多帧路径复用;预检同单帧口径) */
export async function runFrameGenerationAndWriteback(
  graph: ReturnType<typeof findStoryboardWorkflowForContext> extends infer T ? NonNullable<T> : never,
  shot: StoryboardItem,
  frame: NonNullable<StoryboardItem["keyframes"]>[number],
  frameNodeId: string,
  guard: ReturnType<typeof createBatchSourceGuard>,
  degradedResolution?: string,
): Promise<void> {
  const { imageUrl, vlmArtifact } = await generateWithVlmReview(graph, frameNodeId, shot, {
    addMaterial: useStudioStore.getState().addMaterial,
    degradedResolution,
    guard,
  });
  if (!imageUrl) throw new Error("生成结果为空");
  guard.assertCurrent();
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  guard.write(() => {
    landStoryboardContinuity(shot.id, latest.id, frameNodeId);
    const node = latest.nodes.find((item) => item.id === frameNodeId);
    const frameMediaRef = {
      kind: "image" as const,
      path: imageUrl,
      imageWorkflowId: latest.id,
      imageWorkflowNodeId: frameNodeId,
    };
    // 增量回写必须以 store 现势为基(批次快照里的 shot.keyframes 是旧值,
    // 直接在其上映射会丢掉前几帧已落的写入——多帧串行实测坑)
    const liveFrames = useStudioStore.getState().storyboards.find((item) => item.id === shot.id)?.keyframes
      ?? shot.keyframes
      ?? [];
    const updatedFrames = liveFrames.map((candidate) =>
      candidate.frameId === frame.frameId
        ? { ...candidate, mediaRef: frameMediaRef, origin: { kind: "generated" as const } }
        : candidate,
    );
    useStudioStore.getState().setStoryboardKeyframes(shot.id, updatedFrames, "generate");
    const written = useStudioStore.getState().storyboards.find((item) => item.id === shot.id)!;
    const liveGraph = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? latest;
    useStudioStore.getState().upsertImageWorkflow({ ...liveGraph, targetSourceFingerprint: written.sourceFingerprint });
    if (shot.stale) {
      const stillStale = updatedFrames.some((item) => frameNeedsGeneration({ ...written, stale: true, staleSince: shot.staleSince }, item));
      useStudioStore.getState().updateStoryboard(shot.id, {
        stale: stillStale,
        staleSince: stillStale ? shot.staleSince : undefined,
        staleReason: stillStale ? shot.staleReason : undefined,
      });
    }
    if (vlmArtifact) useStudioStore.getState().writeStoryboardVlmReview(shot.id, {
      ...vlmArtifact,
      generatedAt: vlmArtifact.generatedAt || Date.now(),
    }, imageUrl);
    void node;
  });
}
