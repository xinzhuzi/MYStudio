import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createId,
  createImageWorkflowGraph,
  generatedSlotPosition,
  nextStackedPosition,
  promptSlotPosition,
  referenceSlotPosition,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import {
  EXTENDED_STORYBOARD_STYLE_TOKENS,
  getExtendedStoryboardFactionData,
  getExtendedStoryboardFrameNegative,
  getExtendedStoryboardManualContent,
  withActiveVisualManualStoryboardStyleTokens,
} from "@/lib/studio/visual-manual-style-tokens";
import { useStudioStore } from "@/stores/studio/studio-store";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import {
  adaptTemplateBriefToCastCount,
  adaptTemplateBriefToShotMotion,
  buildStoryboardFactionColorSection,
  buildStoryboardFramePrompt,
  resolveAssetFaction,
  parseStoryboardFrameTemplates,
  selectStoryboardFrameTemplate,
} from "@/lib/studio/storyboard-frame-prompt";
import type {
  AssetImageWorkflowContext,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";

/**
 * 手动加节点的落位:同类型列内最低卡片之下再落一张(布局单源
 * lib/studio/image-workflow/layout)。旧版按同类计数×固定间距落位,
 * 间距远小于实际卡高,加第二个节点起必与前者重叠。
 */
export function nextNodePosition(graph: ImageWorkflowGraph, type: ImageWorkflowNode["type"]) {
  return nextStackedPosition(graph.nodes, type);
}

export function resolveGenerationTargetNodeId(graph: ImageWorkflowGraph, nodeId: string) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return undefined;
  if (node.type === "generated") return node.id;
  if (node.type !== "prompt") return undefined;
  const edgeTarget = graph.edges.find((edge) => edge.source === node.id)?.target;
  const targetNodeId = edgeTarget || node.targetNodeId;
  return graph.nodes.some((item) => item.id === targetNodeId && item.type === "generated")
    ? targetNodeId
    : undefined;
}

export function resolveActionGeneratedNode(
  graph: ImageWorkflowGraph,
  selectedNodeId: string | null,
  preferredGeneratedNodeId: string | null,
) {
  const selectedTargetId = selectedNodeId
    ? resolveGenerationTargetNodeId(graph, selectedNodeId)
    : undefined;
  const preferredTargetId =
    preferredGeneratedNodeId &&
    graph.nodes.some(
      (node) => node.type === "generated" && node.id === preferredGeneratedNodeId,
    )
      ? preferredGeneratedNodeId
      : undefined;
  const fallbackTargetId =
    selectedTargetId ??
    preferredTargetId ??
    graph.nodes
      .filter((node) => node.type === "prompt")
      .map((node) => resolveGenerationTargetNodeId(graph, node.id))
      .find(Boolean) ??
    graph.nodes.find((node): node is ImageWorkflowGeneratedNode => node.type === "generated")?.id;
  return graph.nodes.find(
    (node): node is ImageWorkflowGeneratedNode =>
      node.type === "generated" && node.id === fallbackTargetId,
  );
}

export function resolveOpenContextGeneratedNodeId(
  graph: ImageWorkflowGraph,
  context: ImageWorkflowOpenContext,
) {
  const generatedNodes = graph.nodes.filter(
    (node): node is ImageWorkflowGeneratedNode => node.type === "generated",
  );
  // G5(M1d):多帧流按 frameId 精确定位——resultUrl 匹配在回接帧预挂结果时
  // 会撞首帧,禁用该启发式于多帧场景;单帧流维持原顺序。
  const frameIds = new Set(
    (context.storyboardKeyframes ?? []).map((frame) => frame.frameId).filter(Boolean),
  );
  if (frameIds.size > 1) {
    const firstEmptyFrame = (context.storyboardKeyframes ?? [])
      .map((frame) => generatedNodes.find((node) => node.frameId === frame.frameId && !node.resultUrl))
      .find(Boolean);
    const firstFrame = generatedNodes.find((node) => node.frameId && frameIds.has(node.frameId));
    return firstEmptyFrame?.id ?? firstFrame?.id ?? generatedNodes[0]?.id ?? null;
  }
  const resultMatch = context.resultImagePath
    ? generatedNodes.find((node) => node.resultUrl === context.resultImagePath)
    : undefined;
  const promptMatch = context.prompt
    ? generatedNodes.find((node) => node.prompt === context.prompt)
    : undefined;
  return resultMatch?.id ?? promptMatch?.id ?? generatedNodes[0]?.id ?? null;
}

export function findLinkedPromptNodeForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
) {
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  return graph.nodes.find(
    (node): node is ImageWorkflowPromptNode =>
      node.type === "prompt" &&
      (node.targetNodeId === generatedNodeId || inputNodeIds.includes(node.id)),
  );
}

export function focusNodeIdsForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
) {
  const generatedNode = graph.nodes.find(
    (node): node is ImageWorkflowGeneratedNode =>
      node.type === "generated" && node.id === generatedNodeId,
  );
  if (!generatedNode) return [];
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  const promptNode = findLinkedPromptNodeForGenerated(graph, generatedNodeId);
  const nearbyReferenceNodeIds = graph.nodes
    .filter(
      (node): node is ImageWorkflowReferenceNode =>
        node.type === "reference" && inputNodeIds.includes(node.id),
    )
    .sort(
      (left, right) =>
        Math.abs(left.position.y - generatedNode.position.y) -
        Math.abs(right.position.y - generatedNode.position.y),
    )
    .slice(0, 3)
    .map((node) => node.id);
  return Array.from(new Set([
    ...nearbyReferenceNodeIds,
    generatedNode.id,
    ...(promptNode ? [promptNode.id] : []),
  ]));
}

export function workflowTargetLabel(
  graph: ImageWorkflowGraph,
  context: AssetImageWorkflowContext | undefined,
  storyboards: StoryboardItem[],
  targetStoryboardId: string,
) {
  if (graph.target.kind === "asset") return assetTargetLabel(graph.target, context);
  const storyboardId =
    graph.target.kind === "storyboard" && graph.target.id
      ? graph.target.id
      : targetStoryboardId;
  if (storyboardId) {
    const storyboard = storyboards.find((item) => item.id === storyboardId);
    return storyboard
      ? `分镜 ${storyboard.index} · ${storyboard.prompt.slice(0, 24)}`
      : `分镜 · ${storyboardId}`;
  }
  if (graph.target.kind === "material" && graph.target.id) return `项目素材 · ${graph.target.id}`;
  return "未绑定目标";
}

export function openContextTargetLabel(
  context: ImageWorkflowOpenContext,
  storyboards: StoryboardItem[],
) {
  if (isAssetOpenContext(context)) return assetTargetLabel(context.target, context);
  if (context.target.kind === "storyboard" && context.target.id) {
    const storyboard = storyboards.find((item) => item.id === context.target.id);
    return storyboard
      ? `分镜 ${storyboard.index} · ${storyboard.prompt.slice(0, 24)}`
      : `分镜 · ${context.target.id}`;
  }
  if (context.target.kind === "material" && context.target.id) return `项目素材 · ${context.target.id}`;
  return context.title || "当前图片工作流";
}

export function isSameImageWorkflowTarget(
  left: ImageWorkflowGraph["target"],
  right: ImageWorkflowGraph["target"],
) {
  return imageWorkflowTargetKey(left) === imageWorkflowTargetKey(right);
}

/**
 * 打开上下文的工作流复用判定:目标一致,且分镜目标要求指纹时必须与工作流盖戳一致。
 * 指纹不匹配=工作流属于「同 id 但已被替换的上一代分镜」(2026-08-22 实证:06-01
 * 旧 43 镜工作流占着新 82 镜 1-43 的 id,旧提示词会生成旧镜头画面)。
 * 上下文未带指纹(资产/素材目标)时退化为纯目标匹配,行为不变。
 */
export function matchesStoryboardOpenContext(
  graph: ImageWorkflowGraph,
  context: ImageWorkflowOpenContext,
) {
  if (!isSameImageWorkflowTarget(graph.target, context.target)) return false;
  const required = context.storyboardSourceFingerprint;
  if (context.target.kind !== "storyboard" || !required) return true;
  return graph.targetSourceFingerprint === required;
}

/**
 * 分镜工作流择优(身份防线 08-24): 同 target 同指纹的多代工作流并存时
 * (历史形态:旧代 image-flow-* 空参考 + 新代 storyboard-flow-* 参考齐全),
 * 优先返回带参考节点者——空参考工作流的提示词无 @图N/身份锚点,模型会
 * 自由发挥角色形象(S08 实证:监工赵四被画成清瘦剑客相)。
 */
export function findStoryboardWorkflowForContext(
  graphs: ImageWorkflowGraph[],
  context: ImageWorkflowOpenContext & { associateAssetsNames?: string[] },
): ImageWorkflowGraph | undefined {
  const hasReferences = (graph: ImageWorkflowGraph) => graph.nodes.some((node) => node.type === "reference");
  const matched = graphs.filter((graph) => matchesStoryboardOpenContext(graph, context));
  const refBearingExact = matched.find(hasReferences);
  if (refBearingExact) return refBearingExact;
  if (context.target.kind === "storyboard") {
    // 次优:同目标、无指纹但带参考的工作流(旧建流函数不写 targetSourceFingerprint,
    // 指纹门禁会误挡)。无指纹无法判代——分镜表换代后同 id 镜内容已换(S20 实证:
    // 6月旧表的客栈镜工作流被当成新表街巷镜,参考压制画面生成错图)。代际校验=
    // 内容对齐:工作流参考节点 title 须全部出现在当前分镜行的资产清单里,任一
    // 清单外资产即视为跨代流拒绝;空参考无指纹者代次不明,同样不选。
    const currentNames = new Set((context.associateAssetsNames ?? []).map((name) => name.trim()));
    const alignedWithCurrentShot = (graph: ImageWorkflowGraph) =>
      graph.nodes
        .filter((node) => node.type === "reference")
        .every((node) => {
          const title = (node.title ?? "").replace(/·分层$/, "").trim();
          return !title || currentNames.size === 0 || currentNames.has(title)
            || [...currentNames].some((name) => title.includes(name) || name.includes(title));
        });
    const secondary = graphs.find((graph) =>
      isSameImageWorkflowTarget(graph.target, context.target)
      && !graph.targetSourceFingerprint
      && hasReferences(graph)
      && alignedWithCurrentShot(graph));
    if (secondary) return secondary;
  }
  return matched[0];
}

/**
 * 参考完备性补挂(身份防线 08-24): 复用既有分镜工作流而图内无资产参考时,
 * 按 createOpenImageWorkflowGraph 同款参数补挂解析出的参考并连向成图节点;
 * 幂等(已有参考节点原样返回)。
 */
export function ensureStoryboardAssetReferences(
  graph: ImageWorkflowGraph,
  references: ImageWorkflowOpenContext["assetReferences"],
): ImageWorkflowGraph {
  if (!references?.length) return graph;
  if (graph.nodes.some((node) => node.type === "reference")) return graph;
  let next = graph;
  references.forEach((reference, index) => {
    next = addReferenceImageNode(next, {
      id: createId("asset-ref", Date.now() + index + 1),
      title: reference.title,
      imageUrl: reference.imageUrl,
      source: { kind: "asset", assetType: reference.assetType, id: reference.assetId },
      continuityOrder: index + 1,
      position: nextStackedPosition(next.nodes, "reference"),
    });
  });
  const generatedNodeId = next.nodes.find((node) => node.type === "generated")?.id;
  if (generatedNodeId) {
    for (const node of next.nodes.filter((item) => item.type === "reference")) {
      next = connectImageWorkflowNodes(next, { source: node.id, target: generatedNodeId });
    }
  }
  return ensureStoryboardBindingConsistency(next);
}

/**
 * 装配门禁(08-24 S15 根因补): 参考集合变化(建流/补挂/清理)后,prompt 的
 * @图N 绑定句必须与「连向主成图、按 continuityOrder 排序」的运行时参考
 * 顺序一致——不一致时按现顺序重写头段。参考变了绑定句不跟着变 = 模型把
 * @图2 的身份约束套到错误的参考图上(人物张冠李戴的机制性根源)。
 */
export function ensureStoryboardBindingConsistency(graph: ImageWorkflowGraph): ImageWorkflowGraph {
  if (graph.target.kind !== "storyboard") return graph;
  const mainGen = graph.nodes.find(
    (node) => node.type === "generated"
      && !node.title?.includes("背景板") && !node.title?.includes("净底"),
  );
  if (!mainGen) return graph;
  const orderedRefs = graph.edges
    .filter((edge) => edge.target === mainGen.id)
    .map((edge) => graph.nodes.find((node) => node.id === edge.source))
    .filter((node): node is ImageWorkflowReferenceNode => node?.type === "reference" && Boolean(node.title))
    .sort((a, b) => (a.continuityOrder ?? Number.MAX_SAFE_INTEGER) - (b.continuityOrder ?? Number.MAX_SAFE_INTEGER));
  if (orderedRefs.length === 0) return graph;
  const kindLabel: Record<string, string> = { scene: "场景", character: "角色", prop: "道具" };
  const head = orderedRefs
    .map((ref, i) => `@图${i + 1} 为${ref.title}${kindLabel[(ref.source as { assetType?: string } | undefined)?.assetType ?? ""] ?? ""}`)
    .join("；");
  const expected = /@图\d+\s*为/.test(head) ? head : "";
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "prompt") return node;
    const old = node.prompt ?? "";
    if (expected) {
      const bodyStart = old.indexOf("【");
      const body = bodyStart >= 0 ? old.slice(bodyStart) : old.trim();
      if (!body) return node;
      const next = `${expected}\n${body}`;
      if (next !== old) { changed = true; return { ...node, prompt: next }; }
    }
    return node;
  });
  if (!changed) return graph;
  return { ...graph, nodes, updatedAt: Date.now() };
}

/**
 * 存量工作流构图段自愈(08-29 R18 存量盲区根修):建流期的人物数自适应只覆盖
 * 新建流;R21 让同代工作流持续复用后,修复前建的老流(构图段仍是「只有角色
 * A 与 B」双人约束)永不刷新——S07 实证 4 人镜被双人模板逼出 5 人。重生复用
 * 前按 shotSemantics.visibleCharacters 对 prompt 节点构图行补跑自适应,幂等。
 */
export function healStoryboardPromptForCast(
  graph: ImageWorkflowGraph,
  castNames?: string[],
  frameText?: string,
): ImageWorkflowGraph {
  if (graph.target.kind !== "storyboard") return graph;
  const names = (castNames ?? []).map((name) => name.trim()).filter(Boolean);
  let anyChanged = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "prompt" || !node.prompt) return node;
    let nodeChanged = false;
    const lines = node.prompt.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i]!.startsWith("【构图】")) continue;
      // 双重自愈:镜头类型(行进镜去对峙化) → 人数(双人约束按 cast 改写)
      const healed = adaptTemplateBriefToCastCount(
        adaptTemplateBriefToShotMotion(lines[i]!, frameText ?? ""),
        names,
      );
      if (healed !== lines[i]) { lines[i] = healed; nodeChanged = true; }
    }
    if (!nodeChanged) return node;
    anyChanged = true;
    return { ...node, prompt: lines.join("\n") };
  });
  if (!anyChanged) return graph;
  return { ...graph, nodes, updatedAt: Date.now() };
}

export function assetWorkflowContextKey(context: ImageWorkflowOpenContext) {
  return [context.imageWorkflowId ?? "", imageWorkflowTargetKey(context.target)].join("|");
}

export function isAssetOpenContext(
  context: ImageWorkflowOpenContext | undefined,
): context is AssetImageWorkflowContext {
  return Boolean(context?.target.kind === "asset" && context.target.assetType);
}

export function createOpenImageWorkflowGraph(
  context: ImageWorkflowOpenContext,
  projectName: string,
) {
  let graph = createImageWorkflowGraph({
    id: context.imageWorkflowId,
    name: `${projectName} · ${context.title} 图片工作流`,
    target: context.target,
  });
  if (context.storyboardSourceFingerprint) {
    graph = { ...graph, targetSourceFingerprint: context.storyboardSourceFingerprint };
  }
  // 分镜工作流三件套(ma-gongbi-v1 手册资产,全部 fail-empty):
  // ① 提示词按手册装配顺序结构化(【画面】+【构图】模板要点),再挂视觉手册风格锁
  //    (生成链路幂等不双拼;手册未预热时退化裸描述,行为不变);
  // ② Negative Prompt 预填五类英文负面词;
  // ③ 关联资产参考图自动挂载(场景在前角色在后,order 1..k)。
  const isStoryboard = context.target.kind === "storyboard";
  const frameTemplate = isStoryboard
    ? selectStoryboardFrameTemplate(
        [context.prompt ?? "", context.storyboardLines ?? ""].join("\n"),
        parseStoryboardFrameTemplates(getExtendedStoryboardManualContent()),
      )
    : null;
  // 阵营色彩职责:参考资产按轨道分桶查阵营(场景→scene 轨/角色→person 轨)
  const factionData = getExtendedStoryboardFactionData();
  const sceneRefNames = context.assetReferences?.filter((ref) => ref.assetType === "scene").map((ref) => ref.title);
  const personRefNames = context.assetReferences?.filter((ref) => ref.assetType === "character").map((ref) => ref.title);
  const propRefNames = context.assetReferences?.filter((ref) => ref.assetType === "prop").map((ref) => ref.title);
  const colorSection = isStoryboard && frameTemplate
    ? buildStoryboardFactionColorSection(
        { sceneNames: sceneRefNames, personNames: personRefNames, propNames: propRefNames },
        factionData,
      )
    : "";
  // 装配溯源(UI「风格依据」展示源):命中了哪些手册资产一目了然
  if (isStoryboard) {
    const tracedFactions = [...(personRefNames ?? []), ...(sceneRefNames ?? [])]
      .map((name) => resolveAssetFaction(name, factionData.members))
      .filter((factionName): factionName is string => Boolean(factionName));
    graph = {
      ...graph,
      assemblyTrace: {
        manualId: useStudioStore.getState().workflowConfig.visualManualId,
        templateId: frameTemplate?.id,
        templateTitle: frameTemplate?.title,
        factions: [...new Set(tracedFactions)],
        factionTracks: colorSection
          ? [personRefNames?.length ? "person" : "", sceneRefNames?.length ? "scene" : ""].filter(Boolean)
          : [],
        negativeApplied: Boolean(getExtendedStoryboardFrameNegative()),
        styleTokenCount: frameTemplate ? EXTENDED_STORYBOARD_STYLE_TOKENS.length : 0,
        assetReferenceTitles: context.assetReferences?.map((ref) => ref.title),
      },
    };
  }
  const basePrompt = isStoryboard
    ? buildStoryboardFramePrompt({
        description: context.prompt ?? "",
        lines: context.storyboardLines,
        template: frameTemplate,
        // R18:构图模板按画面人数自适应(三人镜/单人镜不再被双人模板锁死)
        castNames: context.storyboardVisibleCharacters,
        colorSection,
      })
    : (context.prompt ?? "");
  const prompt = isStoryboard
    ? withActiveVisualManualStoryboardStyleTokens(basePrompt)
    : basePrompt;
  const negativePrompt = isStoryboard ? getExtendedStoryboardFrameNegative() : undefined;
  const generatedNodeId = createId("gen");
  const promptNodeId = createId("prompt");
  const referenceImagePath = context.sourceImagePath || context.resultImagePath;
  const referenceNodeId = referenceImagePath ? createId("ref") : "";
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  // 关键帧序列声明上提:多帧流(2~4 帧)成对克隆 gen+prompt,输入列提示词区
  // 须按帧数预留槽位,参考图才能排在所有提示词之下(两列+泳道布局)
  const keyframes = (context.storyboardKeyframes ?? []).filter((frame) => frame.frameId);
  const isMultiFrame = isStoryboard && keyframes.length > 1 && keyframes.length <= 4;
  const frameSlotCount = isMultiFrame ? keyframes.length : 1;
  // 生图画幅跟随成片(用户裁定 08-27 晚:横屏视频,分镜图必须 16:9;
  // 全局设置曾是 1:1 方图导致分镜图乱七八糟)。资产/自由目标仍用用户设置。
  const genAspectRatio = isStoryboard
    ? (DEFAULT_REMOTION_RENDER_SETTINGS.width >= DEFAULT_REMOTION_RENDER_SETTINGS.height ? "16:9" : "9:16")
    : imageSettings.defaultAspectRatio;
  if (referenceImagePath) {
    graph = addReferenceImageNode(graph, {
      id: referenceNodeId,
      title: context.target.kind === "storyboard" ? "当前分镜参考图" : "来源参考图",
      imageUrl: referenceImagePath,
      source: context.target,
      position: referenceSlotPosition(0, frameSlotCount),
    });
  }
  // 输入列垂直堆叠(布局单源):提示词区在上,来源参考图占参考区第 0 格,
  // 资产参考依次向下;成图列右置,「输入→成图」连线全走中间空泳道,
  // 不被卡片遮挡(2026-08-29 用户裁定)。
  context.assetReferences?.forEach((reference, index) => {
    graph = addReferenceImageNode(graph, {
      id: createId("asset-ref", Date.now() + index + 1),
      title: reference.title,
      imageUrl: reference.imageUrl,
      source: { kind: "asset", assetType: reference.assetType, id: reference.assetId },
      continuityOrder: index + 1,
      position: referenceSlotPosition((referenceImagePath ? 1 : 0) + index, frameSlotCount),
    });
  });
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `${context.title} 成图`,
    prompt,
    position: generatedSlotPosition(0),
  });
  graph = addPromptImageNode(graph, {
    id: promptNodeId,
    title: "图片生成",
    prompt,
    negativePrompt: negativePrompt || undefined,
    aspectRatio: genAspectRatio,
    resolution: imageSettings.defaultResolution,
    targetNodeId: generatedNodeId,
    position: promptSlotPosition(0),
  });
  if (context.resultImagePath) {
    graph = setGeneratedImageResult(graph, generatedNodeId, {
      imageUrl: context.resultImagePath,
    });
  }
  if (referenceNodeId) {
    graph = connectImageWorkflowNodes(graph, {
      source: referenceNodeId,
      target: generatedNodeId,
    });
  }
  graph.nodes
    .filter((node) => node.type === "reference" && node.id.includes("asset-ref"))
    .forEach((node) => {
      graph = connectImageWorkflowNodes(graph, {
        source: node.id,
        target: generatedNodeId,
      });
    });
  graph = connectImageWorkflowNodes(graph, {
    source: promptNodeId,
    target: generatedNodeId,
  });

  // 关键帧序列(M1d,design §4.1):>1 帧时首对节点充当帧1,后续每帧克隆一对
  // gen+prompt;共享参考全部连到每个帧 gen;gen(k-1)→gen(k) 构成
  // previous-approved-frame 帧间连贯链;回接帧(已有图)预挂 resultUrl 入流。
  if (isMultiFrame) {
    const sharedRefSources = graph.edges
      .filter((edge) => edge.target === generatedNodeId && edge.source !== promptNodeId)
      .map((edge) => edge.source);
    // 首帧:既有 gen/prompt 对即帧1(标题/帧标记/时刻段)
    const momentOf = (index: number) =>
      keyframes[index].momentDescription
        ? `\n\n【本帧时刻·第${index + 1}/${keyframes.length}帧·约${Math.round(keyframes[index].inUs / 1_000_000)}s】${keyframes[index].momentDescription}`
        : "";
    graph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === generatedNodeId
          ? {
              ...node,
              title: `${context.title} 成图 · 帧1/${keyframes.length}`,
              frameId: keyframes[0].frameId,
              frameMoment: keyframes[0].momentDescription,
            }
          : node.id === promptNodeId && node.type === "prompt"
            ? { ...node, prompt: `${node.prompt}${momentOf(0)}` }
            : node,
      ),
      updatedAt: Date.now(),
    };
    if (keyframes[0].mediaRef?.path) {
      graph = setGeneratedImageResult(graph, generatedNodeId, { imageUrl: keyframes[0].mediaRef.path });
    }
    let previousGenId = generatedNodeId;
    for (let index = 1; index < keyframes.length; index += 1) {
      const frame = keyframes[index];
      const frameGenId = createId("gen");
      const framePromptId = createId("prompt");
      // 每帧一对:提示词进输入列第 index 槽、成图进成图列第 index 槽
      // (旧版堆叠间距小于卡高,多帧流从第二帧起互相层叠)。
      graph = addGeneratedImageNode(graph, {
        id: frameGenId,
        title: `${context.title} 成图 · 帧${index + 1}/${keyframes.length}`,
        prompt,
        position: generatedSlotPosition(index),
        frameId: frame.frameId,
        frameMoment: frame.momentDescription,
      });
      graph = addPromptImageNode(graph, {
        id: framePromptId,
        title: `图片生成·帧${index + 1}`,
        prompt: `${prompt}${momentOf(index)}`,
        negativePrompt: negativePrompt || undefined,
        aspectRatio: genAspectRatio,
        resolution: imageSettings.defaultResolution,
        targetNodeId: frameGenId,
        position: promptSlotPosition(index),
      });
      for (const source of sharedRefSources) {
        graph = connectImageWorkflowNodes(graph, { source, target: frameGenId });
      }
      graph = connectImageWorkflowNodes(graph, { source: framePromptId, target: frameGenId });
      // 帧间连贯链:上一帧成图作为本帧参考(previous-approved-frame,request 组装层自动识别)
      graph = connectImageWorkflowNodes(graph, { source: previousGenId, target: frameGenId });
      if (frame.mediaRef?.path) {
        graph = setGeneratedImageResult(graph, frameGenId, { imageUrl: frame.mediaRef.path });
      }
      previousGenId = frameGenId;
    }
  }

  // 装配门禁②:绑定句与最终参考集合一致(建流尾部即校验,而非等生成)
  return ensureStoryboardBindingConsistency(graph);
}

export function imageWorkflowTargetKey(target: ImageWorkflowGraph["target"]) {
  return [target.kind, target.assetType ?? "", target.parentId ?? "", target.id ?? ""].join(":");
}

export function assetTargetLabel(
  target: ImageWorkflowGraph["target"],
  context?: AssetImageWorkflowContext,
) {
  if (target.kind !== "asset") return "未绑定资产";
  const typeLabel =
    target.assetType === "character"
      ? "角色衍生"
      : target.assetType === "scene"
        ? "场景衍生"
        : "道具衍生";
  return `${typeLabel} · ${context?.title || target.id || "未命名"}`;
}

/**
 * 参考面板材料分组(T3):材料库 kind=image 混着「用户上传/导入的设定参考图」与
 * 「工作流成图回流」(generation/upscale 完成后 addMaterial 入库)。判据用
 * createWorkflowFilename 的稳定文件名前缀(产品自写,非启发式):
 * gen-*(成图)/up4x-*(超分成图) → workflow-output;ref-* 与其余 → asset-reference。
 */
export function splitImageMaterialsByOrigin(materials: StudioMaterial[]): {
  assetReferences: StudioMaterial[];
  workflowOutputs: StudioMaterial[];
} {
  const assetReferences: StudioMaterial[] = [];
  const workflowOutputs: StudioMaterial[] = [];
  for (const material of materials) {
    const baseName = material.localPath.split("/").pop() ?? material.localPath;
    if (/^(?:gen|up4x)-/i.test(baseName)) workflowOutputs.push(material);
    else assetReferences.push(material);
  }
  return { assetReferences, workflowOutputs };
}
