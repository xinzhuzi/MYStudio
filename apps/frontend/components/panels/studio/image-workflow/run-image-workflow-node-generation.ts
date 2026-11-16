import { aiManager } from "@/lib/ai/ai-manager";
import { DEFAULT_LOCAL_IMAGE_MODEL } from "@/stores/ai/api-config-provider-helpers";
import { maybeAutoDenoiseUrl } from "@/lib/ai/image-auto-denoise";
import { buildUnclothChainRequest } from "@/lib/assist/image-studio/uncloth-request";
import { runUnclothChain } from "@/lib/assist/image-studio/run-uncloth";
import { isNsfwProModel } from "@/lib/assist/image-studio/nsfw-request";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import {
  assertImageWorkflowContinuityCapability,
  buildImageWorkflowGenerationRequest,
  collapseTransparentNodes,
  setGeneratedImageResult,
  updateImageWorkflowNode,
} from "@/lib/studio/image-workflow";
import {
  findSubjectOverlapBlocks,
  getStoryboardBaseSubjectText,
  lintCanonicalPrompt,
} from "@/lib/studio/storyboard-canonical-prompt";
import { buildStoryboardCanonicalTransportInput, cropSlotReferenceToSinglePose } from "./storyboard-canonical-context";
import { useProjectStore } from "@/stores/project/project-store";
import { resolveBoundTemplateForGeneration } from "@/stores/settings/workflow-bindings-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type {
  ImageWorkflowNode, ImageWorkflowGraph } from "@/types/studio";
import {
  chapterScopeForWorkflowTarget,
  createWorkflowFilename,
  prepareReferenceImages,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";

/**
 * 单节点生图核心(自 use-image-workflow-generation.generateNode 提取,行为零变化):
 * 组装黄金公式请求→连续性门禁→file:// 参考按需转 dataURL 传输→风格锁→
 * generateImage→项目内保存→材料入库→成图节点回写,返回最终轻量 URL。
 * 不含:generating/failed 状态置位、toast、分镜回写——由调用方编排
 * (单镜 hook 与分镜面板批量串行 hook 各自决定失败策略)。
 */
export async function runImageWorkflowNodeGeneration(
  graph: ImageWorkflowGraph,
  targetNodeId: string,
  input: {
    addMaterial: (material: { name: string; localPath: string; size: number }) => string;
    /**
     * 失败回退阶梯第三段(09-15 P3):降载降分辨率——覆盖图内分辨率档
     * (最低档 1K,降显存降时长)。缺省=不降,行为零变化。
     */
    degradedResolution?: string;
    /** 同步核验调用方冻结的项目/章节/上游来源；过期时抛错拒写。 */
    assertStillCurrent?: () => void;
  },
): Promise<{ imageUrl: string }> {
  // 无衣物链分流(09-04 通用化,与图片工作室同源):成图有 uncloth 上游且
  // 链输入齐备时执行 uncloth 管线(双分割+两遍采样),结果直通本成图并回显
  // uncloth 节点——不走普通 t2i/i2i 通道。节点按钮/批量链/ops 全部经此分流,
  // 链输入缺位(错误分支)由调用方 hook 阻断并指路。
  const unclothRequest = buildUnclothChainRequest(graph, targetNodeId);
  if (!("error" in unclothRequest)) {
    input.assertStillCurrent?.();
    const result = await runUnclothChain(unclothRequest, input.assertStillCurrent);
    input.assertStillCurrent?.();
    // 回写须基于 store 最新代(与普通链同纪律;旁路操作可能已推进图)
    const latest =
      useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
    let updated = setGeneratedImageResult(latest, targetNodeId, {
      imageUrl: result.imageUrl,
      mediaId: result.mediaId,
    });
    updated = updateImageWorkflowNode(updated, unclothRequest.unclothNodeId, {
      resultUrl: result.imageUrl,
    });
    useStudioStore.getState().upsertImageWorkflow(updated);
    return { imageUrl: result.imageUrl };
  }

  const request = buildImageWorkflowGenerationRequest(graph, targetNodeId);
  const isStoryboard = graph.target.kind === "storyboard";
  const finalModel = isStoryboard ? DEFAULT_LOCAL_IMAGE_MODEL : (request.model ?? DEFAULT_LOCAL_IMAGE_MODEL);
  // S3 工作流绑定注入(11-02-engine-model-workflow-hus):大模型+非分镜时,按
  // 有无参考图取绑定件(文生图/图生图位)注入 extraParams.template——经
  // ai-sdk-bridge Object.assign 透传进 sidecar body(server.py→pipeline template=),
  // 出图实走绑定件;未绑=undefined=引擎按类型自动选(道劫默认零迁移)。
  // 分镜批量恒 qi21 走既有裁定模板,不绑(验收回归项)。
  const boundTemplate = isStoryboard
    ? undefined
    : resolveBoundTemplateForGeneration(finalModel, request.referenceImages.length > 0);
  if (!request.prompt.trim()) {
    throw new Error("成图是生图的最后一步,不能单独生图——请把提示词节点(或无衣物/NSFW破限节点)连到它的输入口再生成");
  }
  // NSFW破限链引擎守卫(09-07-nsfw-pro-node):专业流只有本地 Krea2/
  // ComfyUI桥消费 use_lora,其余引擎(含云端)静默忽略——抛错阻断并指路,
  // 不静默降级成普通流(与图片工作室同款文案)
  if (request.nsfwPro && !isNsfwProModel(request.model)) {
    throw new Error("NSFW破限链仅支持本地 Krea2(或 ComfyUI桥):把成图的模型切到 Krea2,或断开破限连线后再生成");
  }
  if (!isStoryboard) assertImageWorkflowContinuityCapability(request);

  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) throw new Error("请先选择项目");
  // 资产参考(file:// 与 asset-file://)按需转 dataURL 传输:节点只存轻量
  // 虚拟/受管路径(持久化纪律,防 dataURL 入库 OOM),发送前经 IPC 读受管图
  // 转 base64——与 project-file:// 参考同口径,不落盘。
  const assetBridge = getStudioAssetsBridge();
  const assetRefIdsByUrl = new Map(
    graph.nodes
      .filter((node): node is typeof node & { type: "reference"; imageUrl: string } =>
        node.type === "reference"
        && Boolean(
          node.imageUrl?.startsWith("file://")
          || node.imageUrl?.startsWith("asset-file://")
          || node.imageUrl?.startsWith("/"),
        )
        && node.source?.kind === "asset" && Boolean(node.source.id))
      .map((node) => [node.imageUrl as string, (node.source as { id: string }).id]),
  );
  const resolvedReferenceUrls = await Promise.all(request.referenceImages.map(async (url) => {
    const assetId = assetRefIdsByUrl.get(url);
    if (!assetId || !assetBridge?.readImageDataUrl) return url;
    return await assetBridge.readImageDataUrl(assetId).catch(() => null) ?? url;
  }));
  const referenceImages = await prepareReferenceImages(resolvedReferenceUrls);
  // —— 分镜换线正典传输(1116,PRD §五.3/§4.5)——
  // 体裁路由:零槽=t2i 主体句(07 五项序);有槽=i2i 指令体(09 篇,分镜=无画布
  // 造新图,参考全=identity source)。App 层装配/手册风格锁/帧编译/拼板塌缩
  // 全退役——400 只装体裁化句,底座/类型句/负面/透明/画幅由正典装配链(引擎)
  // 注入。参考按 §4.5 槽位(image_1=主角/image_2=场景/image_3=前帧或次角色)
  // 原生多张 dataURL 直传;负面退役(正典三源 merge 引擎承担)。
  let transportReferenceImages = referenceImages;
  let canonicalPrompt: string | null = null;
  if (isStoryboard) {
    const shot = useStudioStore.getState().storyboards.find((item) => item.id === graph.target.id);
    if (!shot) throw new Error("分镜行已不存在,无法按正典体裁装配提示词(请重新打开该分镜)");
    const { instruction, mapping } = await buildStoryboardCanonicalTransportInput(shot, graph, targetNodeId);
    // 硬纪律门(§4.2,建流/传输同源断言):违规=引擎 1017 运行时门必拒,
    // 网络前拦截省一次排队烧图。
    const violations = lintCanonicalPrompt(instruction.prompt, instruction.genre, mapping.slots.length);
    if (violations.length) {
      void logEvent({
        level: "warn",
        category: "ai",
        operationId: createOperationId("storyboard-canonical-lint"),
        message: "Storyboard canonical prompt rejected by discipline lint",
        context: { shotId: shot.id, shotIndex: shot.index, violations },
      });
      throw new Error(`分镜正典提示词未过体裁断言:${violations.map((v) => `${v.rule}(${v.detail})`).join("、")}`);
    }
    // 重叠预检(宪法§十/§4.2):与型底座 ≥10 字公共子串=重复块,须去重后重发。
    const overlaps = findSubjectOverlapBlocks(instruction.prompt, getStoryboardBaseSubjectText());
    if (overlaps.length) {
      void logEvent({
        level: "warn",
        category: "ai",
        operationId: createOperationId("storyboard-canonical-overlap"),
        message: "Storyboard canonical prompt rejected by base overlap precheck",
        context: { shotId: shot.id, shotIndex: shot.index, overlaps },
      });
      throw new Error(`分镜正典提示词与型底座重叠(≥10 字重复块 ${overlaps.length} 处),须去重:…${overlaps[0]!.block}…`);
    }
    canonicalPrompt = instruction.prompt;
    if (mapping.slots.length) {
      // 槽位图 dataURL 解析+准备(节点只存轻量受管路径,传输才转 base64,
      // 持久化纪律与资产参考同口径)。
      // 1116 第六病理三代修:角色/道具横幅多视图卡出图前裁正面单姿
      // (命令原文「只有设定卡时裁/选正面单姿,禁整卡」;裁切失败=丢槽
      // 留痕+指令体重排,宁缺勿染)——赵四类无单姿资产整卡入 image_1=
      // 转面稿四副本。
      const resolvedSlotUrls = await Promise.all(mapping.slots.map(async (slot) => {
        const assetId = assetRefIdsByUrl.get(slot.imageUrl);
        if (!assetId || !assetBridge?.readImageDataUrl) return slot.imageUrl;
        return await assetBridge.readImageDataUrl(assetId).catch(() => null) ?? slot.imageUrl;
      }));
      const croppedSlotUrls: Array<string | null> = [];
      const dropSlotIndexes: number[] = [];
      for (const [index, slot] of mapping.slots.entries()) {
        const resolved = resolvedSlotUrls[index]!;
        if (!resolved.startsWith("data:")) {
          // 未解析为 dataURL 的槽无法解码裁切,原样入链;角色横幅卡若走到这里
          // 会绕过单姿化(第六病理风险),留痕便于排障(§4.5 道具不入槽)。
          if (slot.role === "character") {
            void logEvent({
              level: "warn",
              category: "ai",
              operationId: createOperationId("storyboard-slot-pose-crop-skipped"),
              message: "Storyboard slot reference skipped single-pose crop: unresolved non-data URL",
              context: { shotId: graph.target.id, slot: slot.slot, role: slot.role, title: slot.title },
            });
          }
          croppedSlotUrls.push(resolved);
          continue;
        }
        const cropped = await cropSlotReferenceToSinglePose(resolved, slot.role);
        if (cropped !== null) {
          croppedSlotUrls.push(cropped);
        } else {
          // 横幅卡裁不出单姿=丢槽留痕,禁整卡入参考(丢槽重排在 context 件)。
          dropSlotIndexes.push(index);
          croppedSlotUrls.push(null);
          void logEvent({
            level: "warn",
            category: "ai",
            operationId: createOperationId("storyboard-slot-pose-crop-failed"),
            message: "Storyboard slot reference dropped: multi-view card failed single-pose crop",
            context: { shotId: graph.target.id, slot: slot.slot, role: slot.role, title: slot.title },
          });
        }
      }
      let effectiveSlots = mapping.slots;
      if (dropSlotIndexes.length) {
        const rebuilt = await buildStoryboardCanonicalTransportInput(shot, graph, targetNodeId, dropSlotIndexes);
        canonicalPrompt = rebuilt.instruction.prompt;
        effectiveSlots = rebuilt.mapping.slots;
      }
      const keptUrls = croppedSlotUrls.filter((url): url is string => url !== null);
      transportReferenceImages = await prepareReferenceImages(keptUrls);
      assertImageWorkflowContinuityCapability(
        { ...request, model: finalModel, referenceImages: transportReferenceImages },
        {
          kind: "storyboard-native-references",
          imageUrls: transportReferenceImages,
          slots: effectiveSlots.map((slot, index) => ({
            slot: slot.slot, role: slot.role, title: slot.title, imageUrl: transportReferenceImages[index]!,
          })),
          // 来源参考=全量参考的已解析形态(dataURL/base64,与槽位图同一解析路),
          // 槽位子集核验才同域可比(原始 file:// 与传输 dataURL 不可直接相等)。
          sourceReferenceImages: referenceImages,
        },
      );
    } else {
      // 零槽(t2i 路):参考全裁出(§4.5 纯道具镜)——传输零参考,连续性
      // 断言按零参考形态核(无版本参考在飞)。
      transportReferenceImages = [];
      assertImageWorkflowContinuityCapability({
        ...request, model: finalModel, referenceImages: [], continuityRequired: false,
      });
    }
  }
  const node = graph.nodes.find((item) => item.id === targetNodeId);
  const chapterId = chapterScopeForWorkflowTarget(
    graph.target,
    useStudioStore.getState().storyboards,
  );
  // 10-19 用户裁定(B):分镜生图原生走 qwen-image-2-1(qi21-道劫-t2i,mikkoani×0.8)。
  // 09-14 K2 桥路由就此退役;1116 换线后分镜请求恒 qi21+base_type=分镜剧情图,
  // 底座/类型句/负面/透明/画幅全由引擎正典装配链注入。自由/资产工作流保留
  // 节点自选模型。
  const buildRequest = (transport?: "chat") => ({
    prompt: isStoryboard ? canonicalPrompt! : request.prompt,
    model: finalModel,
    aspectRatio: request.aspectRatio,
    // 降载重试(09-15 P3 阶梯第三段):显式降档覆盖;缺省保持图内档位
    resolution: input.degradedResolution ?? request.resolution,
    // 分镜负面退役(1116 换线):正典三源 merge(底座负面+型负面+主体句负面)
    // 由引擎装配链承担,App 传输不再携带;自由/资产工作流负面照旧。
    negativePrompt: isStoryboard ? undefined : request.negativePrompt,
    promptPolicy: (isStoryboard ? "raw" : undefined) as "raw" | undefined,
    referenceImages: transportReferenceImages,
    // NSFW破限链(09-07):use_lora 经 extraParams 进请求体,引擎层与全局
    // 专业流开关或关系合并(ai-sdk-bridge Object.assign 透传);
    // S3 绑定注入(11-02):template 同路透传,绑了=出图实走绑定工作流
    extraParams: {
      ...(request.nsfwPro ? { use_lora: true } : undefined),
      ...(boundTemplate ? { template: boundTemplate } : undefined),
      // L5(11-15 类型词断点①·历史欠账 1010 起从未接通):分镜域节点级注入
      // qi21 第7型「分镜剧情图」(positive 635 字/16:9,十型真源=引擎家
      // qi21_bases.json)。引擎两路消费现成零改——i2i 带 base_type 自动切
      // 「道劫美术类型」全拼档(类型句进装配,qwen21.py:334-351),t2i 经
      // apply_base_type 覆写 6:4010 型层(顺带正画幅 16:9,替代画布快照
      // 「人物海报」3:4 竖幅);节点级优先于全局 localImageBaseType
      // (image-generation-engine.ts:577-580),非分镜请求零影响。
      ...(isStoryboard ? { base_type: "分镜剧情图" } : undefined),
    },
    transport,
    // 分镜/工作流成图自存项目真源(projectFiles.saveImage),跳过媒体库副本双写
    persistMedia: false,
  });
  /**
   * 人物一致性硬闸门(08-30 用户裁定):单节点成图在节点置 ready 前拦截。
   * - 仅当挂了角色类参考图且 VLM 模型就绪时生效;
   * - character_ok=false → 抛错(节点 failed,文件留盘作证据但不进任何下游);
   * - VLM 缺模型/审核异常一律 fail-open 放行(与批量链同语义)。
   */
  const assertCharacterGate = async (imageUrl: string): Promise<void> => {
    const bridge = typeof window !== "undefined" ? window.vlmReview : undefined;
    if (!bridge?.run) return;
    let probeOk = false;
    try {
      probeOk = (await bridge.probe()).status === "ready";
    } catch {
      return;
    }
    if (!probeOk) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    // 塌缩视图(09-09):闸门按「实际发往引擎的参考」核验,与 request 同口径
    const refNodes = collapseTransparentNodes(graph).edges
      .filter((edge) => edge.target === targetNodeId)
      .map((edge) => byId.get(edge.source))
      .filter(
        (candidate): candidate is Extract<ImageWorkflowNode, { type: "reference" }> =>
          candidate?.type === "reference" && Boolean(candidate.imageUrl),
      );
    const refs = refNodes.map((refNode) => ({
      path: refNode.imageUrl!,
      role: ((refNode.source as { assetType?: string } | undefined)?.assetType ?? "character") as "scene" | "character" | "prop",
      assetName: refNode.title,
    }));
    const characterRefs = refs.filter((ref) => ref.role === "character");
    if (characterRefs.length === 0) return;
    try {
      const artifact = await bridge.run({
        schemaVersion: 1,
        projectId,
        shotId: chapterId ?? graph.id,
        generatedImagePath: imageUrl,
        referenceImages: refs,
        expectedContent: request.prompt,
        expectedCharacters: characterRefs.map((ref) => ref.assetName),
      });
      if (artifact.status === "rejected" && artifact.checks.character_ok === false) {
        const reasons = (artifact.reasons ?? []).join("；");
        void logEvent({
          level: "warn",
          category: "ai",
          operationId: createOperationId("character-gate-rejected"),
          message: "Character gate rejected generated image",
          context: { targetNodeId, reasons, references: characterRefs.length },
        });
        throw new Error(`人物一致性未过（VLM 闸门）：${reasons || "成图角色与参考不一致"}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("人物一致性未过")) throw error;
      // VLM 审核 runtime 异常:fail-open
    }
  };

  const generateAndSave = async (transport?: "chat") => {
    input.assertStillCurrent?.();
    const generated = await aiManager.generateImage(buildRequest(transport));
    // 生图落库自动去噪(噪点治理 08-29):开关开启时,成图在写入项目
    // workflow-images 前先过轻度双边滤波;失败原样保存(fail-open)。
    const denoisedSource = await maybeAutoDenoiseUrl(generated.url);
    input.assertStillCurrent?.();
    const saved = await getProjectFilesBridge()?.saveImage({
      projectId,
      relativePath: workflowImageRelativePath(
        graph.id,
        createWorkflowFilename("gen", targetNodeId, `${node?.title || "workflow-image"}.png`),
        chapterId,
      ),
      source: denoisedSource,
    });
    input.assertStillCurrent?.();
    return { generated, saved };
  };
  const generateAndGate = async (transport?: "chat") => {
    const outcome = await generateAndSave(transport);
    if (outcome.saved?.success && outcome.saved.url) {
      await assertCharacterGate(outcome.saved.url);
    }
    return outcome;
  };
  // 10-19 B 裁定:分镜已原生 qi21,K2 桥回落重试整段退役(桥路不再被尝试)
  let { generated: result, saved } = await generateAndGate();
  if ((!saved?.success || !saved.url) && /^https?:/i.test(result.url)) {
    // 08-24 结构修复:images 端点已成功(生成已计费)但远程 URL 下载失败
    // (晚高峰 CDN 504/网关过载)——旧路径直接抛错丢图。此处回退 chat 形态
    // 重试一次:base64 data-URL 直返、不经 CDN,保存走主进程 dataURL 解析。
    // 08-25 日志补齐:回退事件入 diagnostics(此前仅 console,排障盲区)。
    void logEvent({
      level: "warn",
      category: "ai",
      operationId: createOperationId("image-workflow-url-save-fallback"),
      message: "Image URL save failed, falling back to chat base64 retry",
      context: {
        workflowId: graph.id,
        targetNodeId,
        saveError: (saved?.error || "").slice(0, 200),
        remoteUrlPrefix: result.url.slice(0, 100),
      },
    });
    console.warn(
      "[image-workflow] 成图 URL 保存失败(下载类),回退 chat base64 重试一次:",
      saved?.error || result.url.slice(0, 80),
    );
    ({ generated: result, saved } = await generateAndGate("chat"));
  }
  if (!saved?.success || !saved.url) {
    throw new Error(saved?.error || "项目内图片保存失败");
  }
  input.assertStillCurrent?.();
  const materialId = input.addMaterial({
    name: `${node?.title || "workflow-image"}.png`,
    localPath: saved.url,
    size: saved.size ?? 0,
  });
  // 成图节点回写须基于 store 最新代(参考解析等旁路可能已推进图)
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  const updated = setGeneratedImageResult(latest, targetNodeId, {
    imageUrl: saved.url,
    mediaId: materialId ?? result.mediaId,
  });
  input.assertStillCurrent?.();
  useStudioStore.getState().upsertImageWorkflow(updated);
  return { imageUrl: saved.url };
}
