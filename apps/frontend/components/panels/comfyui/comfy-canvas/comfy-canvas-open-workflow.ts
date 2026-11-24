// 把工作流打开到 ComfyUI 画布里(分镜流程链、单镜视频两条路),含拼装脚本与网页视图元素类型。2026-11-24 超线文件拆分:从 ComfyCanvasStudio.tsx 拆出;原文件仍是入口,导出名不变。
"use client";

import { toast } from "sonner";
import type { ComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { tryResolveProductionEpisodeId } from "@/components/panels/studio/workflow-helpers";
import { parseShotTarget } from "@/lib/comfyui/comfy/comfy-bridge-writeback-consumer";
import { createHttpComfyWorkflowLibraryTransport } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import { buildShotH3ThreeStageWorkflow, buildShotH3Workflow } from "@/lib/comfyui/h3/h3-shot-video-workflow";
import { useStoryboardH3VideoSessionStore } from "@/stores/studio/storyboard-h3-video-session-store";
import { dialogueAudioPolicy } from "@/lib/comfyui/h3/h3-shot-prompt";
import { ensureStageAssetCoversUploaded, readStoryboardImageB64 } from "@/lib/comfyui/storyboard/storyboard-overview-sync";
import {
  applyStageInjections,
  buildStageInjections,
  buildStageNodePayloadFromState,
  buildStageSummaries,
  MAINLINE_TAB_NAME,
  STAGE_TEMPLATE_REPO_ID,
} from "@/lib/comfyui/storyboard/storyboard-pipeline-comfy";
import { mapProductionFlowNodesToStagePayloads } from "./stage-payload-map";
import type { ProductionFlowNodeModel } from "../../studio/workflow-node-model-schema";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";

/**
 * 工作流阶段自动打开分镜总览(09-10 用户裁定:进入工作流阶段,ComfyUI 展示
 * 本章分镜内容;1_图片/2_视频/3_声音 域树归大模型模块浏览)。
 * 轮询等 window.app(新前端 GraphView 异步赋值),每次页面加载只开一次
 * (守卫变量),app 永不出现则静默放弃(画布回退默认视图)。
 * 就绪谓词含 isGraphReady:window.app 早于 graph 初始化出现,只查方法存在
 * 会在未初始化 graph 上调 loadGraphData——上游 ComfyApp 因此打
 * "graph accessed before initialization" 且加载流程半途断掉
 * (09-11 实弹:画布右侧露黑带的竞态入口之一)。
 */
export function buildOverviewOpenScript(
  graph: Record<string, unknown>,
  workflowId: string,
  options: { force?: boolean } = {},
): string {
  const literal = JSON.stringify(graph);
  const idLiteral = JSON.stringify(workflowId);
  const guard = options.force ? "false" : "window.__myOverviewAutoOpened";
  return `(function () {
  function tryLoad(attempt) {
    var app = window.app;
    if (app && app.isGraphReady === true && typeof app.loadGraphData === "function") {
      window.__myOverviewAutoOpened = true;
      // 09-12 单实例协议:优先走侧栏扩展提供的 __myOpenWorkflow(绑定库
      // 文件+复用既有签,永不重复/永不 Unsaved);扩展缺席(旧引擎)先等几拍,
      // 仍无则带名直载兜底(name=库内相对全路径,loadGraphData 第4参语义,
      // 裸文件名会落到 workflows 根层命中不了库条目)。
      var payload = { name: ${idLiteral}, graph: ${literal} };
      try {
        // 双锚:新 __myOpenWorkflow 优先;旧 __manyingOpenWorkflow 过渡期兜底
        // (装机新 asar × 引擎家尚未重同步旧 JS 的窗口)。
        const opener = window.__myOpenWorkflow || window.__manyingOpenWorkflow;
        if (typeof opener === "function") {
          // 1013 Draft.v2 幽灵根修:Q1a 刷新策略在主线签已开+未保存修改(画布
          // 自动保存的陈旧态)时 kept-modified 短路不重载——用户画布修改保住了,
          // 但宿主数据演进也被同一守卫挡死(剧本落库后节点预览永停开屏快照)。
          // 短路时转引擎侧属性级热补丁 __myStagePatch:按 stage key 原位 patch
          // +重渲染,不整图重载不碰用户布局;旧引擎无该助手=维持原行为。
          Promise.resolve(opener(payload)).then(function (result) {
            if (result && result.mode === "kept-modified"
              && typeof window.__myStagePatch === "function") {
              try { window.__myStagePatch(payload.graph); } catch (e2) { /* 补丁失败=维持陈旧,不炸 */ }
            }
          }).catch(function () { /* opener 异常=维持原行为 */ });
          return;
        }
        if (attempt < 20) { setTimeout(function () { tryLoad(attempt + 1); }, 300); return; }
        app.loadGraphData(payload.graph, true, true, payload.name);
      } catch (e) {
        try { app.loadGraphData(payload.graph, true, true, payload.name); } catch (e2) { /* 留默认视图 */ }
      }
      return;
    }
    if (attempt < 50) setTimeout(function () { tryLoad(attempt + 1); }, 300);
  }
  if (!${guard}) tryLoad(0);
})();`;
}

/**
 * ComfyUI 定制铁律(09-11 用户裁定×2):原生零干预——除登录屏蔽外,不改动
 * /隐藏任何 ComfyUI 原生 UI 与逻辑,其他插件模块一概不碰;漫影的定制只影响
 * 漫影自己的东西(my_nodes 自研节点/漫影侧栏/工作流库数据)。一切以
 * 外挂形式承载(宿主 webview 注入/custom_nodes/工作流库数据),永不改
 * ComfyUI 本体源码。(曾被误做的「工作流模块隐藏工作流库 dock 项」已整体撤除。)
 */

/** Electron webview 的宿主注入面(React 类型表不覆盖 webview tag 专有 API)。 */
export type WebviewElement = HTMLElement & {
  insertCSS?: (css: string) => Promise<string>;
  executeJavaScript?: (code: string) => Promise<unknown>;
  __selectionHooked?: boolean;
  /** autoOpen 在途锁:封面转换是 async,dom-ready/did-finish-load 双事件
   * 防并发重复组装注入(完成后复开无害,页内单实例协议自会聚焦既有)。 */
  __autoOpenInFlight?: boolean;
};

/** autoOpen 载荷组装+注入(09-12 v4 真跑根修:封面先经 ensureStageAsset-
 * CoversUploaded 上传改写为引擎 input 文件名再进画布——此前直带 app-scheme
 * cover,画布 /view 必 404,资产卡恒字牌)。async 独立函数:读值全走
 * getState/ref,无闭包陈旧;dom-ready 监听同步侧 void 调用。 */
export async function openStageWorkflowIntoCanvas(
  node: WebviewElement,
  stageFlowNodesRef: { current: ProductionFlowNodeModel[] | undefined },
  force = false,
): Promise<void> {
  const originProjectId = useProjectStore.getState().activeProjectId;
  if (!originProjectId) return;
  const state = useStudioStore.getState();
  // 10-15 P2 空章开门:零分镜不再整链早退——载荷 buildStageNodePayloadFromState
  // 全 ?? [] 防御、buildStageSummaries 空表引导文案,空章注入七环节骨架引导;
  // 与 P1 保鲜链空章放行(storyboard-overview-sync 10-14)同口径,门齐开即闭环
  const originEpisodeId = tryResolveProductionEpisodeId(state) ?? "episode-1"; // D6:画布注入面用安全变体,不可定位走哨兵(下方 scopeChanged 守卫兜底)
  // v4 内容全量:优先老画布节点模型映射(技能/资产卡/队列进度/渲染器链);
  // 无模型(测试/异常)回落 store 快照构建
  const flowNodes = stageFlowNodesRef.current;
  const payloads = flowNodes && flowNodes.length > 0
    ? mapProductionFlowNodesToStagePayloads(flowNodes)
    : buildStageNodePayloadFromState(state);
  let scopeChanged = false;
  const unsubscribeProject = useProjectStore.subscribe((next) => {
    if (next.activeProjectId !== originProjectId) scopeChanged = true;
  });
  const unsubscribeStudio = useStudioStore.subscribe((next) => {
    if ((tryResolveProductionEpisodeId(next) ?? "episode-1") !== originEpisodeId) scopeChanged = true;
  });
  try {
    await ensureStageAssetCoversUploaded(payloads);
    if (scopeChanged || !node.isConnected) return;
    // The template stays read-only; the captured chapter exists only in this clone.
    const injections = buildStageInjections({ summaries: buildStageSummaries(state), payloads, originProjectId, originEpisodeId });
    const template = await createHttpComfyWorkflowLibraryTransport()
      .content(STAGE_TEMPLATE_REPO_ID)
      .catch(() => null);
    if (template === null || scopeChanged || !node.isConnected
      || useProjectStore.getState().activeProjectId !== originProjectId
      || (tryResolveProductionEpisodeId(useStudioStore.getState()) ?? "episode-1") !== originEpisodeId) return;
    const graph = applyStageInjections(template, injections);
    await node.executeJavaScript?.(
      buildOverviewOpenScript(graph, MAINLINE_TAB_NAME, force ? { force: true } : undefined),
    )?.catch(() => undefined);
  } finally {
    unsubscribeProject();
    unsubscribeStudio();
  }
}

export async function openShotVideoWorkflowIntoCanvas(
  node: WebviewElement,
  client: ComfyEngineClient,
  note: string | undefined,
  isActive: () => boolean,
): Promise<void> {
  const originProjectId = useProjectStore.getState().activeProjectId;
  if (!originProjectId) throw new Error("请先打开回写目标项目");
  const state = useStudioStore.getState();
  const originEpisodeId = tryResolveProductionEpisodeId(state) ?? "episode-1"; // D6:画布注入面用安全变体,不可定位走哨兵(下方 scopeChanged 守卫兜底)
  const chapterShots = state.storyboards.filter((item) => item.episodeId === originEpisodeId);
  const storyboardId = parseShotTarget(note, chapterShots);
  const shot = storyboardId ? chapterShots.find((item) => item.id === storyboardId) : undefined;
  if (!shot) {
    toast.error("找不到这面镜头");
    return;
  }
  if (shot.mediaRef?.kind !== "image" || !shot.mediaRef.path) {
    toast.error("该镜还没有关键帧");
    return;
  }
  const chapter = state.novelChapters.find((item) => item.id === shot.episodeId);
  const chapterLabel = chapter?.title || shot.episodeId;
  const safeId = shot.id.replace(/[^A-Za-z0-9._-]+/g, "_");
  const imageName = `my-shot-h3-${safeId}.jpg`;
  const imageB64 = await readStoryboardImageB64(shot.mediaRef.path);
  if (!isActive()) throw new Error("项目已切换或画布已关闭，请重新打开单镜工作流");
  const uploaded = await client.uploadBridgeReference(imageName, imageB64);
  if (!uploaded?.accepted) throw new Error("关键帧上传失败");
  if (!isActive() || useProjectStore.getState().activeProjectId !== originProjectId) throw new Error("项目已切换，请从当前项目重新打开单镜工作流");
  // 10-11 音频分工 R3a:逐镜音频政策派生(有角色行→full 台词烧镜内+口型,
  // 否则 ambient 音效床),替旧硬编码 "ambient";voiceMood 音色锚直通
  // storyboard.emotion(D1)。
  // 1112 recavsr-mainline 模板换血登记:会话在档配方为三采族时,画布直开吃新母体
  // (h3-three-stage-template.json=repo 主线件原样拷贝语义);缺省/其它配方=旧模板
  // 零变。会话 store 是批量/单镜共用的配方记忆(续跑同轨),画布直开跟读。
  const sessionRecipeId = useStoryboardH3VideoSessionStore.getState().session?.recipeId;
  const isSancaiRecipe = sessionRecipeId === "my-h3-sancai-r2v" || sessionRecipeId === "my-h3-sancai-i2v";
  const workflow = isSancaiRecipe
    ? buildShotH3ThreeStageWorkflow({ shot, chapterId: shot.episodeId, chapterLabel, policy: dialogueAudioPolicy(shot.lines), voiceMood: shot.emotion, imageName, originProjectId, r2v: sessionRecipeId !== "my-h3-sancai-i2v" })
    : buildShotH3Workflow({ shot, chapterId: shot.episodeId, chapterLabel, policy: dialogueAudioPolicy(shot.lines), voiceMood: shot.emotion, imageName, originProjectId });
  // 09-14 通用化(零文件):单镜视频=组装器现装直开,不再写 分镜/3_单镜视频
  await node.executeJavaScript?.(buildOverviewOpenScript(workflow.ui, `${workflow.name}.json`, { force: true }));
  toast.success(`已打开 ${String(workflow.name.match(/S\d+$/)?.[0] || `S${String(shot.index).padStart(2, "0")}`)} 单镜视频工作流`);
}
