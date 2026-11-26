"use client";
// ComfyUI 画布工作室(09-09 comfyui-frontend-swap 0b,辅助面板第六 tab)。
//
// webview 嵌自管引擎完整前端(ComfyUI 原生界面:节点库/工作流/插件管理)。
// 引擎状态机复用设置页引擎卡链(useComfyEngineSettings):
// - 未安装/需准备 → 一键安装(手动点击,绝不自动)
// - 已就绪未跑 → 进视图即静默自动拉起引擎(09-29 用户令「打开 ComfyUI 视图
//   即确保引擎就绪」:复用设置页 start 引擎链,零 toast 不打断,见挂载确保
//   effect);手动启动按钮兜底(冷启动 job 轮询,torch 加载可达两分钟)
// - 运行中(port 就绪) → webview 指向 http://127.0.0.1:<port>/
// 该 tab 也是后续阶段(业务自定义节点/画布主体切换)的调试台。

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, PlayCircle, ServerCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useComfyEngineSettings } from "@/components/panels/settings/comfy-engine/useComfyEngineSettings";
import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { tryResolveProductionEpisodeId } from "@/components/panels/studio/workflow-helpers";
import { consumeComfyBridgeWritebacks } from "@/lib/comfyui/comfy/comfy-bridge-writeback-consumer";
import { consumeComfyBridgeActions } from "@/lib/comfyui/comfy/comfy-bridge-action-consumer";
import { probeEngineUrl } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import {
  getRemoteEngineVersion,
  resolveEngineBase,
  subscribeRemoteEngineChanged,
} from "@/lib/studio/engine-line/resolve-engine-base-url";
import { invalidateOverviewSyncForEngineStart, syncStoryboardOverviewToLibrary } from "@/lib/comfyui/storyboard/storyboard-overview-sync";
import { buildStageNodePayloadFromState } from "@/lib/comfyui/storyboard/storyboard-pipeline-comfy";
import { storyboardImageHumanApproved } from "@/lib/studio/storyboard-image-review-gate";
import { mapProductionFlowNodesToStagePayloads } from "./stage-payload-map";
import type { ProductionFlowNodeModel } from "../../studio/workflow-node-model-schema";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";

/** 漫影登录遮蔽脚本(09-10 云端收编):真源=引擎侧扩展
 * my_nodes/web/my_login_cloak.js(随 custom_nodes 分发,ComfyUI
 * 自动加载 extensions 目录全部 js)——装机旧版 app 重启引擎即生效,不依赖
 * app 打包;外部浏览器直访引擎同样覆盖。遮蔽「登录 / 注册」入口+点击拦截
 * +登录弹窗自动关,中文包含匹配(精确匹配抓不到「登录 / 注册」合成串,
 * 实弹教训)。
 *
 * 本层是 app 侧第二道(引擎扩展缺席/被删时兜底),与引擎层同码零漂移
 * (?raw 导入整文件)。上游 i18n 改词漏遮时,凭据补丁(cloud_takeover)
 * 仍是功能层兜底:杂散 comfy.org token 永不被采用。换漫影登录的口子=
 * 宿主设 window.MY_ACCOUNT_URL(旧名 MANYING_ACCOUNT_URL 仍兼容;见该文件头注)。 */
import type { WebviewElement } from "./comfy-canvas-open-workflow";
import { openStageWorkflowIntoCanvas, openShotVideoWorkflowIntoCanvas } from "./comfy-canvas-open-workflow";
import {
  WEBVIEW_SELECTION_CSS,
  buildSignInCloakScript,
  buildCanvasFitScript,
  readRenderQueueSnapshot,
} from "./comfy-canvas-webview-scripts";
export {
  WEBVIEW_SELECTION_CSS,
  buildSignInCloakScript,
  buildCanvasFitScript,
} from "./comfy-canvas-webview-scripts";
export { buildOverviewOpenScript } from "./comfy-canvas-open-workflow";

export interface ComfyCanvasStudioProps {
  /**
   * 工作流阶段专用(09-10 用户裁定):webview 就绪即自动打开本章分镜总览。
   * 仅「分镜制作」挂载点启用;大模型模块的沉浸视图保持完整域树浏览。
   */
  autoOpenOverview?: boolean;
  /**
   * 模块分野(09-11 用户裁定:按模块对待漫影插件的展示与功能)。
   * "workflow"=工作流模块:漫影分镜侧栏在场(分镜生产工具);
   * "models"=大模型模块:纯浏览场景,漫影分镜侧栏不注册。
   * 经 webview 双通道传给引擎前端扩展:URL 参数 myScope(首载)+ useragent
   * 尾缀(09-22:端口漂移后唯一可靠通道,见 embedUserAgent)。
   * 09-12 模块分离(用户裁定):models 域三链齐隔离——引擎侧栏库过滤分镜
   * 产线、userdata 工作流树数据层过滤(my_module_policy.js 单源)、
   * 本组件 webview 独立 partition(会话/顶签不再串工作流模块)。
   */
  myScope?: "workflow" | "models";
  /**
   * 制作动作通道宿主侧(09-11 旧画布功能迁移收口):漫影侧栏「制作动作」
   * 按钮经 bridge 提交,这里轮询消费并分发到宿主既有批量钩子执行。
   */
  sidebarActions?: {
    onGenerateImages: () => void;
    onGenerateVideos: () => void;
    /** note=付费生成的补充要求(09-12 B1:老画布 userInstruction 语义经桥透传) */
    onGenerateDirectorPlan?: (note?: string) => void;
    onGenerateStoryboardTable?: (note?: string) => void;
    onRebuildWorkbenchTracks?: () => void;
    /** 09-13 用户裁定:节点「全文/编辑」按钮回流——note=环节 key */
    onViewNodeDoc?: (stageKey: string) => void;
    onEditNodeDoc?: (stageKey: string) => void;
    /** 09-13 用户裁定:衍生资产节点「抽取资产」回流(老剧本资产页同款钩子) */
    onExtractAssets?: () => void;
    /** 1120 分镜面板退役迁引擎:面板批量动作全量回流为节点按钮 */
    onGenerateImagesForce?: () => void;
    onGenerateImagesStop?: () => void;
    /** 1120 单镜重出桥(generate-shot-image,note=shotId):单镜 force 重出 */
    onGenerateShotImage?: (shotId?: string) => void;
    /** note=tier(480p 草稿/960p 生产,载荷 noteKey 过桥) */
    onH3Start?: (tier: string) => void;
    onH3Stop?: () => void;
    onH3ImportOrphans?: () => void;
    onH3ArchiveBackfill?: () => void;
    onOpenFinalVideo?: () => void;
    onDaoyanImport?: () => void;
    onChapterPipelineStart?: () => void;
    onAutoBindAssets?: () => void;
    /** 1120 单镜动作面(引擎 shot-detail 浮层);note=shotId / shotId|mode|arg / shotId|value */
    onOpenShotImage?: (shotId: string) => void;
    onCompareFrames?: (shotId: string) => void;
    onCompareVideo?: (shotId: string) => void;
    onKeyframeExtract?: (note: string) => void;
    onSetAudioMix?: (note: string) => void;
  };
  /** 老画布节点模型(viewModel.productionFlowNodes;v4 内容全量喂入) */
  stageFlowNodes?: ProductionFlowNodeModel[];
  /**
   * 1125 章验收横幅联动:画布就绪态(running)上抛宿主——引擎不可达空态时
   * 宿主隐藏横幅,防无上下文的孤儿浮条。仅值变更时回调(宿主 setState 同值
   * 短路,零重渲染噪音)。
   */
  onCanvasRunningChange?: (running: boolean) => void;
}

export function ComfyCanvasStudio({ autoOpenOverview = false, myScope, sidebarActions, stageFlowNodes, onCanvasRunningChange }: ComfyCanvasStudioProps = {}) {
  const webviewRef = useRef<WebviewElement | null>(null);
  // 1105 D3 走查 UX 补:webview 冷载(远端 20-30s)此前全程无反馈=白屏假死。
  // 覆盖层随 did-start-loading 出,ComfyUI 根节点探针确认 UI 真渲染后撤;
  // 90s 硬超时兜底(探针失灵也绝不把用户困在菊花后面)。
  const [webviewLoading, setWebviewLoading] = useState(true);
  // attach 闭包在首次挂载时固化(防重监听),prop 走 ref 保持读取新鲜值
  const autoOpenRef = useRef(autoOpenOverview);
  autoOpenRef.current = autoOpenOverview;
  const stageFlowNodesRef = useRef(stageFlowNodes);
  stageFlowNodesRef.current = stageFlowNodes;
  // dom-ready 不在 React 合成事件类型表里 → ref 回调挂原生监听(幂等防重)。
  // ⚠不可挂载即调:attach 前调 insertCSS 是同步 throw(Electron 实弹 21:31 白屏:
  // "must be attached...before this method"),事件期调用则安全;双事件兜底
  // (did-finish-load 每次加载必发,防 dom-ready 竞态错过),重复注入同规则无害。
  const attachWebview = (node: WebviewElement | null) => {
    webviewRef.current = node;
    if (node && !node.__selectionHooked) {
      node.__selectionHooked = true;
      const inject = () => {
        try {
          node.insertCSS?.(WEBVIEW_SELECTION_CSS)?.catch(() => undefined);
          node.executeJavaScript?.(buildSignInCloakScript())?.catch(() => undefined);
          node.executeJavaScript?.(buildCanvasFitScript())?.catch(() => undefined);
            // 工作流阶段:进入即展示分镜流程链工作流(旧画布迁移 09-11)——
            // 七环节链+分镜网格一张图;脚本内自带一次性守卫。
            // 09-12:封面转换改 async(上传引擎 input 后改写),在途锁防双事件并发
            // 10-15 P2 空章开门:零分镜不再跳过(空表=零缩略仍 autoOpen,
            // 引导文案见 buildStageSummaries 空态分支)
            if (autoOpenRef.current && !node.__autoOpenInFlight) {
              node.__autoOpenInFlight = true;
              void openStageWorkflowIntoCanvas(node, stageFlowNodesRef).finally(() => {
                node.__autoOpenInFlight = false;
              });
            }
        } catch {
          // 未就绪窗口的同步抛错:吞掉,等下一事件兜底
        }
        // 09-12 键盘直通配套:进入画布视图即聚焦 guest——否则键盘停在宿主,
        // 用户须先点一下画布才能用 ComfyUI 快捷键(球面板关闭路径见 OrbShell)
        try {
          node.focus();
        } catch {
          // attach 前的窗口:下一事件兜底
        }
      };
      node.addEventListener("dom-ready", inject);
      node.addEventListener("did-finish-load", inject);
      // 1127 画布自动复活:渲染进程崩溃 → guest target 永久消失(画布永久空白)
      // → 立即换 key 重建 webview 元素,不等周期探测。
      node.addEventListener("crashed", () => setWebviewEpoch((n) => n + 1));
      // 1105 D3 走查 UX:装载覆盖层生命周期——起于 did-start-loading;撤于
      // did-stop-loading 后的根节点探针(ComfyUI 是 JS 应用,资源停≠界面就绪:
      // #comfy-ui/#graph-canvas 真渲染才算数),1.5s 一拍最多 30s 让步撤层。
      node.addEventListener("did-start-loading", () => setWebviewLoading(true));
      node.addEventListener("did-stop-loading", () => {
        const startedAt = Date.now();
        const tick = async () => {
          let uiReady = false;
          try {
            uiReady = Boolean(await node.executeJavaScript?.(
              "!!(document.querySelector('#comfy-ui, #graph-canvas, .comfyui-body'))",
            ));
          } catch {
            uiReady = false;
          }
          if (uiReady || Date.now() - startedAt > 30_000) {
            setWebviewLoading(false);
            return;
          }
          setTimeout(tick, 1500);
        };
        void tick();
      });
    }
  };
  // client 引用必须稳定(传入 hook):否则 hook 内 getComfyEngineClient() 每次
  // 渲染返回新 HTTP client→挂载探测 effect 循环重跑(09-09 实弹报障同根因)
  const client = useMemo(() => getComfyEngineClient(), []);
  const {
    hasBridge,
    status,
    activeJob,
    installEngine,
    startService,
    ensureServiceRunning,
    isStartingService,
    } = useComfyEngineSettings({ client, pollIntervalMs: 1200, statusPollIntervalMs: 5000 });

  const sidebarActionsRef = useRef(sidebarActions);
  sidebarActionsRef.current = sidebarActions;
  const consumeSidebarActions = useCallback(async (projectId: string | null, episodeId: string, isActive: () => boolean) => {
    if (!client) return;
    await consumeComfyBridgeActions({
      client, projectId, episodeId, isActive,
      onError: (error) => toast.error(error instanceof Error ? error.message : "制作动作执行失败"),
      handlerFor: (item) => {
        if (myScope === "models") return undefined;
        const actions = sidebarActionsRef.current;
        const handlers: Record<string, [((note: string) => void) | undefined, string?]> = {
          "generate-images": [actions?.onGenerateImages, "侧栏指令:开始批量生图(当前章未生成分镜)"],
          "generate-videos": [actions?.onGenerateVideos, "侧栏指令:开始生成所有分镜视频"],
          // 1121 bug2 兜底:旧注入存量画布(kept-modified 短路不重注入)仍带
          // 老画布派发 kind enqueue-remotion-shots——归一到 onGenerateVideos
          // (宿主同为 handleRunChapterAutoVideo 钩),不再 reportDeferredOnce
          // 滞留队列;新载荷已统一产 generate-videos(见 stage-payload-map)
          "enqueue-remotion-shots": [actions?.onGenerateVideos, "节点指令:开始生成所有分镜视频"],
          "generate-director-plan": [actions?.onGenerateDirectorPlan, item.note ? "环节指令:生成导演规划(付费·带补充要求)" : "环节指令:生成导演规划(付费云端)"],
          "generate-storyboard-table": [actions?.onGenerateStoryboardTable, item.note ? "环节指令:生成分镜表(付费·带补充要求)" : "环节指令:生成分镜表(付费云端)"],
          "rebuild-workbench-tracks": [actions?.onRebuildWorkbenchTracks, "环节指令:重建视频轨道"],
          "view-doc": [actions?.onViewNodeDoc],
          "edit-doc": [actions?.onEditNodeDoc],
          "extract-assets": [actions?.onExtractAssets, "环节指令:从当前剧本抽取资产"],
          // 1120 分镜面板退役迁引擎:面板批量动作收编为节点按钮
          "generate-images-force": [actions?.onGenerateImagesForce, "节点指令:重出全部画面(当前画面入库为历史版本)"],
          "generate-images-stop": [actions?.onGenerateImagesStop, "节点指令:停止批量生图"],
          "generate-shot-image": [actions?.onGenerateShotImage, "单镜指令:重出本镜画面(note=shotId,当前画面入库为历史版本)"],
          "h3-start": [actions?.onH3Start, item.note === "480p" ? "节点指令:H3 出片(480P 草稿档)" : "节点指令:H3 出片(960P 生产档)"],
          "h3-stop": [actions?.onH3Stop, "节点指令:停止 H3 出片"],
          "h3-import-orphans": [actions?.onH3ImportOrphans, "节点指令:扫描导入盘上 H3 片"],
          "h3-archive-backfill": [actions?.onH3ArchiveBackfill, "节点指令:H3 存量回流"],
          "open-final-video": [actions?.onOpenFinalVideo],
          "daoyan-import": [actions?.onDaoyanImport, "节点指令:导入导演台视频"],
          "chapter-pipeline-start": [actions?.onChapterPipelineStart, "节点指令:章流水线发车"],
          "auto-bind-assets": [actions?.onAutoBindAssets, "节点指令:自动绑定分镜素材"],
          // 1120 单镜动作面(引擎 shot-detail 浮层;note=shotId 编码透传)
          "open-shot-image": [actions?.onOpenShotImage],
          "compare-frames": [actions?.onCompareFrames],
          "compare-video": [actions?.onCompareVideo],
          "keyframe-extract": [actions?.onKeyframeExtract],
          "set-audio-mix": [actions?.onSetAudioMix],
        };
        const [handler, message] = handlers[item.kind] ?? [];
        if (handler) return () => {
          if (message) toast.info(message);
          return handler(item.note || "");
        };
        const node = webviewRef.current;
        if (item.kind === "open-shot-video" && node?.executeJavaScript) {
          return () => openShotVideoWorkflowIntoCanvas(node, client, item.note, isActive);
        }
        return undefined;
      },
    });
  }, [client, myScope]);

  // bridge 回写消费(阶段1):tab 在场即轮询收件箱——收件箱在 sidecar,
  // 引擎停着也可能有积压(上轮画布出图未消费);重叠轮询用 inFlight 压。
  useEffect(() => {
    if (!hasBridge) return;
    let inFlight = false;
    let stopped = false;
    const tick = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      const actionProjectId = useProjectStore.getState().activeProjectId;
      const actionEpisodeId = tryResolveProductionEpisodeId(useStudioStore.getState()) ?? "episode-1"; // D6:tick 起点在 try 外,必须零抛
      let projectChanged = false;
      const unsubscribe = useProjectStore.subscribe((state) => {
        if (state.activeProjectId !== actionProjectId) projectChanged = true;
      });
      const unsubscribeStudio = useStudioStore.subscribe((state) => {
        if ((tryResolveProductionEpisodeId(state) ?? "episode-1") !== actionEpisodeId) projectChanged = true;
      });
      try {
        // 业务侧栏数据面(阶段2 批3):快照与收件箱同 tick 掻/拉。
        // 09-11 续:载荷带当前章节(侧栏按章过滤)+每镜视频/画面就绪标记
        // (分镜页签的视频分类展示)。
        const studioState = useStudioStore.getState();
        const originProjectId = useProjectStore.getState().activeProjectId ?? undefined;
        const storyboards = studioState.storyboards;
        // 09-12 B2:同跳附带渲染队列实时快照(window.remotionQueue 投影→
        // 桥→画布 stage-node 轮询同端点活更徽章;不经保鲜链重写库文件)。
        const episodeId = tryResolveProductionEpisodeId(studioState) ?? "episode-1";
        await (async () => {
          const queue = await readRenderQueueSnapshot(episodeId, storyboards);
          if (stopped || projectChanged || (useProjectStore.getState().activeProjectId ?? undefined) !== originProjectId
            || (tryResolveProductionEpisodeId(useStudioStore.getState()) ?? "episode-1") !== episodeId) return;
          await client?.pushBridgeStoryboards(
            storyboards.map((item) => ({
              id: item.id,
              label: `S${String(item.index).padStart(2, "0")}${item.videoDesc ? ` · ${item.videoDesc.slice(0, 12)}` : ""}`,
              episodeId: item.episodeId,
              videoReady: item.mediaRef?.kind === "video" && Boolean(item.mediaRef.path),
              imageReady: item.mediaRef?.kind === "image" && Boolean(item.mediaRef.path),
              // 1125 人审硬门:宿主门禁现算的图片人审结论位——引擎侧队列钩子
              // (theme.js)对 MyShot/导演台发车按此对账;缺快照/过期照 origin 规则拒。
              humanApproved: storyboardImageHumanApproved(item),
            })),
            episodeId,
            queue,
            originProjectId,
          );
        })().catch(() => undefined);
        // 主视图 ComfyUI 化(批8):总览图库内保鲜(指纹守卫,分镜未动不导入)
        void syncStoryboardOverviewToLibrary({
          buildPayloads: () => {
            const flowNodes = stageFlowNodesRef.current;
            return flowNodes && flowNodes.length > 0
              ? mapProductionFlowNodesToStagePayloads(flowNodes)
              : buildStageNodePayloadFromState(useStudioStore.getState());
          },
        })
          .then((synced) => {
            // 09-14 通用化:保鲜成功=数据有变→主线模板重注入(force 过一次性守卫)
            if (!synced || !autoOpenRef.current) return;
            const canvas = webviewRef.current;
            if (canvas) void openStageWorkflowIntoCanvas(canvas, stageFlowNodesRef, true);
          })
          .catch(() => undefined);
        await consumeComfyBridgeWritebacks({ client });
        // 制作动作通道(09-11 旧画布功能迁移收口):消费侧栏提交的批量动作
        await consumeSidebarActions(actionProjectId, actionEpisodeId, () => !stopped && !projectChanged
          && useProjectStore.getState().activeProjectId === actionProjectId
          && (tryResolveProductionEpisodeId(useStudioStore.getState()) ?? "episode-1") === actionEpisodeId);
      } catch {
        // 消费器内部已吞错并通知;此处兜底静默(轮询面不弹窗轰炸)
      } finally {
        unsubscribe();
        unsubscribeStudio();
        inFlight = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [client, hasBridge, consumeSidebarActions]);

  const installing = activeJob?.state === "running" && activeJob.kind === "install";
  const port = status?.port ?? null;

  // ── 远端引擎接管(1102 remote-engine-takeover S2)──
  // 生效 base=远端配置(settings url)或本机 127.0.0.1:port(R1 统一出口);
  // 远端生效时画布直指远端引擎 UI,本机引擎态(未装/未跑/安装中)一概不再
  // 挡画布——纯备胎(Q2)。remoteEngineVersion=设置页保存/一键切换/清空引擎
  // 地址的通知面(订阅零重启动态切)。
  const remoteEngineVersion = useSyncExternalStore(subscribeRemoteEngineChanged, getRemoteEngineVersion);
  const [engineBase, setEngineBase] = useState<string | null>(null);
  const [remoteActive, setRemoteActive] = useState(false);
  // 1102 复核修:远端地址 A→B 直切必须重探——remoteReady 只由探活回调置位,
  // 地址变更若不重置,探活 effect 的 remoteReady 早退条件会带着 A 的就绪结论
  // 跳过 B,running 恒真、webview 直载未经探活的 B(B 不可达=静默,破 R2)。
  // 与 setEngineBase 同批 setState 无闪帧;地址未变(无关保存触发通知面)不
  // 清=零闪烁。engineBase 只在本 effect 写,ref 比对即「值变更」判据。
  const engineBaseRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveEngineBase(port).then((resolution) => {
      if (cancelled) return;
      const next = resolution.base || null;
      if (engineBaseRef.current !== next) {
        engineBaseRef.current = next;
        setRemoteReady(false); // 地址变更即失效旧探活结论(切回本机同样无害)
      }
      setEngineBase(next);
      setRemoteActive(resolution.remoteActive);
    });
    return () => { cancelled = true; };
  }, [port, remoteEngineVersion]);

  // 远端可达态(1102 R2):远端生效时不再依赖本机 serviceRunning,改探远端
  // 引擎探活(复用 sidecar /comfy/engine/probe 代理——渲染层 CSP 不放行局域
  // 网直连)。不可达=诚实占位「远端引擎未就绪」,绝不静默回落本机(防「看着
  // 本机以为在用 Windows」错位)。未就绪期间 10s 轮询兜底(远端引擎后启动也
  // 能自动接上);就绪即停轮询,手动「重新测试」按钮重置触发即时重探。
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteProbing, setRemoteProbing] = useState(false);
  useEffect(() => {
    if (!remoteActive || !engineBase || remoteReady) return;
    let cancelled = false;
    const run = async () => {
      setRemoteProbing(true);
      try {
        const probe = await probeEngineUrl(engineBase);
        if (!cancelled) setRemoteReady(probe.ok);
      } catch {
        if (!cancelled) setRemoteReady(false);
      } finally {
        if (!cancelled) setRemoteProbing(false);
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [remoteActive, engineBase, remoteReady]);

  // running 口径分叉:远端生效=远端探活 ok(本机 serviceRunning 不参与);
  // 本机模式=serviceRunning+port(现行为回归)。
  const running = remoteActive ? remoteReady : status?.serviceRunning === true && Boolean(port);
  // 1127 画布自动复活:webview guest 偶发死亡(刷新/引擎重启窗口)→ target
  // 永久消失 → 画布永久空白(1126 复测 3/3,与 FreeVideo 无关)。
  const [webviewEpoch, setWebviewEpoch] = useState(0);
  const guestDeadStreakRef = useRef(0);
  // 1125 章验收横幅联动:running 值变更才上抛(回调走 ref 保新鲜——宿主传
  // 内联箭头也不至于每渲染重触发 effect)。
  const onCanvasRunningChangeRef = useRef(onCanvasRunningChange);
  onCanvasRunningChangeRef.current = onCanvasRunningChange;
  useEffect(() => {
    onCanvasRunningChangeRef.current?.(running);
  }, [running]);
  const src = running && engineBase
    ? `${engineBase}/${myScope ? `?myScope=${myScope}` : ""}`
    : null;
  // 1105 D3:src 重建(远端/本机切换、引擎复活保鲜重挂)→ 覆盖层重新武装;
  // 90s 硬超时=探针失灵时的最后兜底(宁早撤勿困死)。
  useEffect(() => {
    setWebviewLoading(true);
    const hardFallback = setTimeout(() => setWebviewLoading(false), 90_000);
    return () => clearTimeout(hardFallback);
  }, [src]);
  // 1127 画布自动复活:界面确认渲染后启用周期探测(guest 内 1+1,8s 超时,
  // 20s 一轮):连续 3 次失败=guest 死亡 → 换 key 重建 webview 元素(等价全新
  // 挂载,冷启动实测 4s)。装载/重载期(webviewLoading)暂停计数不误判;探测
  // 成功即清零。触发源:刷新竞态/引擎重启窗口(1126 复测 3/3)。
  useEffect(() => {
    if (!running || !src || webviewLoading) return;
    const timer = window.setInterval(() => {
      const w = webviewRef.current;
      if (!w || typeof w.executeJavaScript !== "function") return;
      let settled = false;
      void Promise.race([
        Promise.resolve(w.executeJavaScript("1+1")).then(() => { settled = true; }),
        new Promise((resolve) => window.setTimeout(() => resolve("timeout"), 8000)),
      ]).then(() => {
        if (!settled) {
          guestDeadStreakRef.current += 1;
          if (guestDeadStreakRef.current >= 3) {
            guestDeadStreakRef.current = 0;
            setWebviewEpoch((n) => n + 1);
          }
        } else {
          guestDeadStreakRef.current = 0;
        }
      });
    }, 20000);
    return () => window.clearInterval(timer);
  }, [running, src, webviewLoading]);
  // 09-22 端口无关 scope 通道:URL 参数只在首载一瞬可靠(ComfyUI SPA 打开
  // 工作流即改写丢参),引擎侧 localStorage 兜底又按 origin(=引擎端口)隔离
  // ——引擎端口漂移(实录 17000→17001→17002)后新 origin 的 my-scope 种子
  // 落不上,大模型模块侧栏被回落成「分镜阶段」。补第三通道:webview
  // useragent 尾缀 token,每次挂载必设、先于页面任何脚本可读、SPA 改写与
  // 引擎换口均不影响;引擎侧 theme.js myScope() 按 URL→UA→localStorage
  // 顺序解析(外部浏览器直访无尾缀,行为不变)。
  const embedUserAgent = myScope && typeof navigator !== "undefined"
    ? `${navigator.userAgent} MYStudioEmbed/1 myScope=${myScope}`
    : undefined;

  // 09-12 真跑根修:引擎就绪瞬(假→真)失效保鲜指纹并立即补跑一轮——冷启动
  // 窗口(视图先挂载、引擎后启动)跑过的保鲜把上传失败随指纹一起缓存,
  // 镜缩略/资产封面从此被短路跳过(资产卡恒字牌)。失效后 5s tick 也会
  // 兜底重传;这里主动补跑是抢在 autoOpen 打开画布前把文件备齐。
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      invalidateOverviewSyncForEngineStart();
      void syncStoryboardOverviewToLibrary({
        buildPayloads: () => {
          const flowNodes = stageFlowNodesRef.current;
          return flowNodes && flowNodes.length > 0
            ? mapProductionFlowNodesToStagePayloads(flowNodes)
            : buildStageNodePayloadFromState(useStudioStore.getState());
        },
      }).catch(() => undefined);
    }
    prevRunningRef.current = running;
  }, [running]);

  // 09-29 用户令「打开 ComfyUI 视图即确保引擎就绪」:进画布(两路挂载链任一:
  // 大模型沉浸视图 / 分镜制作画布)且引擎已装就绪未跑时,静默后台拉起引擎。
  // running 口径 0929 S2 根修后含令牌核验(后端 status:健康空令牌孤儿按未跑
  // 上报)——「仅开画布」即可触达收编/自愈机器,不再被纯 HTTP 健康探的假
  // running 挡住;令牌一致的正常在跑引擎照旧零重发(幂等闸不变)。
  // 防重复触发三道闸(hook 内实现,见 ensureServiceRunning):
  // ①本谓词挡已跑(!running)/在启(!isStartingService)/任务在途
  //   (activeJob running=install·update·reset 等)。后端 job 闸按类别去重
  //   (engine-start 在跑则复用既有 job;install/update/reset 各自类别自闸),
  //   跨类别并发并无「抢发必败」的全局单任务闸——双向时序由后端各自收敛,
  //   此谓词只省前端一发冗余请求与冗余 toast;
  // ②module 级单例 promise 挡跨实例并发(studio storyboard forceMount+imageWorkflow
  //   双画布=多 hook 实例)与视图重挂载(切 tab 即卸载重挂)+ StrictMode 双挂载;
  // ③手动停止闩(不过期,显式启动成功/重启 App 才解)与失败冷却(hook module
  //   顶共享态)。
  // status 未就位(null)时不发——挂载探测/有界重试拉到状态后本 effect 重跑补发。
  // 0930 画布周期轮询役:本 effect 不再只护挂载时点——上方 hook 调用以
  // statusPollIntervalMs:5000 开启挂载期常驻状态轮询(module 级单 interval,
  // 仅画布开,设置页零变化):
  // ①引擎中途死:轮询把 serviceRunning 翻假 → 本 effect 谓词重评 → 静默
  //   ensure 自动复活(复用 start job 路由,幂等防抖三闸不变);
  // ②令牌自愈窗(停旧→新引擎就绪,数十秒):轮询继续,引擎回来 running 翻真,
  //   src 重建 webview 自动重连,用户无需重进视图(假→真过渡的保鲜补跑 effect
  //   同步触发,资产封面不再卡旧指纹);
  // ③用户显式停止(设置页 stopService 落 module 闩):轮询只观测不拉起——
  //   画布落到「已就绪」面板并保留手动启动按钮,直到用户显式启动或重启 App。
  useEffect(() => {
    // Q2 纯备胎不启动(1102 S6):远端生效期间跳过本机引擎拉起(含 install/
    // start 自动链)——远端模式下画布视图不碰本机引擎,本机仅由本地配置页维护。
    if (remoteActive) return;
    if (!status?.installed || status.state !== "ready") return;
    if (running || isStartingService) return;
    if (activeJob?.state === "running") return;
    void ensureServiceRunning();
  }, [status, running, isStartingService, activeJob, ensureServiceRunning, remoteActive]);

  if (!hasBridge) {
    return (
      <Center>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          当前环境不支持引擎管理(webview 桥不可达),请在桌面应用中使用。
        </p>
      </Center>
    );
  }

  // 远端引擎接管(1102 R2):远端生效时本机引擎态(安装中/未装/未跑/状态未知)
  // 一概不再挡画布;远端探活不可达=诚实占位指引,绝不静默回落本机。
  if (remoteActive && !src) {
    return (
      <Center data-comfy-canvas-remote-pending>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">远端引擎未就绪</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          {`已配置远端引擎(${engineBase ?? "地址解析中"}),当前探活不可达——请确认 Windows 侧 ComfyUI 已启动。`}
        </p>
        {remoteProbing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-comfy-canvas-remote-probing>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在测试连接…
          </div>
        ) : (
          <Button data-comfy-canvas-remote-retest onClick={() => setRemoteReady(false)}>
            重新测试连接
          </Button>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          可在 设置 → 引擎地址 里测试连接或切回本机引擎
        </p>
      </Center>
    );
  }

  // 安装进行中(job 活着)优先展示进度——此时状态查询可能被本地服务抖动挡住。
  // 1102 复核修:以下三处本机态面板均加 remoteActive 旁路——远端生效且 src
  // 就绪(远端探活 ok)时直渲远端 webview,本机「安装中/状态未知/未装」一概
  // 不再拦画布(「远端引擎接管」守卫段注释与 PRD 验收线「本机不跑不影响」的
  // 既定语义)。
  if (!remoteActive && installing) {
    return (
      <Center>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">ComfyUI 画布</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          {`正在安装引擎(${activeJob?.progress ?? 0}%)——${activeJob?.message ?? "下载中,体积较大请耐心等待"}`}
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          安装进行中…
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          安装位置/磁盘可在 设置 → 本地配置 → ComfyUI 引擎 → 存储位置 里自定义
        </p>
      </Center>
    );
  }

  // 状态查询不到(sidecar 未起/刚死/网络抖动):是「未知」不是「未安装」——
  // 09-10 用户实弹报障:引擎已装却渲染「还没安装」,点安装还会被同一门禁挡住。
  // 自愈拉起在 useComfyEngineSettings(连续失败节流 prepare),这里只如实展示。
  if (!remoteActive && !status) {
    return (
      <Center data-comfy-canvas-checking>
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">正在确认引擎状态(本地服务未就绪,正在尝试拉起)…</p>
      </Center>
    );
  }

  // 引擎未装/装了一半:手动一键安装(下载引擎源码+依赖,进度走 job)
  // (远端生效时旁路,见上方 installing 面板注释)
  if (!remoteActive && status && (status.state === "not-installed" || status.state === "needs-setup")) {
    return (
      <Center>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">ComfyUI 画布</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          {status.state === "needs-setup"
            ? "引擎装了一半(上次安装中断),点下面继续安装即可接上。"
            : "还没安装 ComfyUI 引擎。安装只在你点击时开始(源码+依赖体积较大);装好即可使用完整画布与两千多个生态节点。"}
        </p>
        <Button data-comfy-canvas-install onClick={() => void installEngine()}>
          {status.state === "needs-setup" ? "继续安装" : "安装引擎"}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          安装位置/磁盘可在 设置 → 本地配置 → ComfyUI 引擎 → 存储位置 里自定义
        </p>
      </Center>
    );
  }

  // 已就绪未跑:启动(冷启动含 torch 加载,走 job)
  if (!running) {
    return (
      <Center>
        <PlayCircle className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">ComfyUI 已就绪</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          启动需要加载模型运行时(最长两分钟);启动完成后这里就是完整的 ComfyUI 界面。
        </p>
        {isStartingService ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-comfy-canvas-starting>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在启动引擎…
          </div>
        ) : (
          <Button data-comfy-canvas-start onClick={() => void startService()}>
            启动 ComfyUI
          </Button>
        )}
      </Center>
    );
  }

  // running 但生效 base 尚未解析回(local 模式挂载首拍的异步窗口):短暂确认
  // 态占位,不闪 about:blank webview。
  if (!src) {
    return (
      <Center data-comfy-canvas-resolving>
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">正在确认引擎地址…</p>
      </Center>
    );
  }

  // 运行中:webview 加载引擎原生前端(独立进程)。
  // 09-10 用户裁定:状态条与功能按钮(存量迁移/刷新)整块退役——画布即全部,
  // 端口/说明不进布局;存量迁移入口仍在 ComfyCanvasSwap 头部条,刷新=重进页即重探。
  return (
    <div className="relative h-full w-full min-h-0 min-w-0" data-comfy-canvas-frame>
      {webviewLoading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background"
          data-comfy-canvas-loading
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">正在加载 ComfyUI 界面…</p>
          <p className="text-xs text-muted-foreground">
            连接引擎冷启动约 20-30 秒，界面就绪后自动进入
          </p>
        </div>
      )}
      <div className="flex h-full w-full min-h-0 min-w-0 flex-col" data-comfy-canvas-live>
        <webview
        key={webviewEpoch}
        ref={attachWebview}
        src={src ?? "about:blank"}
        // 09-12 模块分离(用户裁定):大模型模块用独立持久会话——ComfyUI
        // 前端从 localStorage(activePath+草稿)恢复上一次画布,默认会话会把
        // 工作流模块的分镜顶签/画布串进大模型模块。独立 partition 后各模块
        // 各记各的会话;workflow 域(studio 两挂载点)不设=默认会话,存量零迁移。
        partition={myScope === "models" ? "persist:my-comfy-models" : undefined}
        // 09-22 端口无关 scope 通道(UA 尾缀):见上方 embedUserAgent 注释
        useragent={embedUserAgent}
        className="h-full w-full flex-1"
        // 独立进程渲染;禁弹窗(09-10 类型收紧:布尔字面量,React 会序列化为属性)
        allowpopups={false}
        data-comfy-canvas-webview
      />
      </div>
    </div>
  );
}

function Center({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center p-6" data-comfy-canvas-placeholder {...rest}>
      {children}
    </div>
  );
}
