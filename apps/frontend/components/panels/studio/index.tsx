import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ManualsTab } from "./ManualsTab";
import { NovelTab } from "./NovelTab";
import { ScriptTab } from "./ScriptTab";
import { WorkbenchTab } from "./WorkbenchTab";
import { ScriptAssetManagementTab } from "./ScriptAssetManagementTab";
import { ComfyCanvasSwap } from "../comfyui/comfy-canvas/ComfyCanvasSwap";
import { useStudioViewModel } from "./useStudioViewModel";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { importDaoyanChapterVideos } from "@/lib/comfyui/storyboard/daoyan-video-import";
import { importH3OrphanVideos, scanH3OrphanVideos } from "@/lib/comfyui/h3/h3-orphan-importer";
import { landFireArchiveH3Videos, pairFireArchiveH3Videos } from "@/lib/comfyui/h3/h3-shot-landing";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { buildProjectFileUrl, parseProjectFileUrl } from "@/lib/upscale/project-file-url";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";
import { buildStoryboardItemOpenContext } from "./storyboard-open-context";
import { saveVideoFramesAsKeyframes } from "@/lib/comfyui/storyboard/shot-keyframe-extraction";
import { ShotImageCompareDialog, ShotVideoCompareDialog } from "./shot-compare-dialogs";
import { ChapterAcceptanceBanner } from "./ChapterAcceptanceBanner";
import { storyboardHasVideo, storyboardHasVisual } from "./storyboard-asset-binding";
import { NodeDocViewer } from "./NodeDocViewer";
import { ScriptEditorDialog } from "./ScriptEditorDialog";
import { useStoryboardBatchGeneration } from "./image-workflow/use-storyboard-batch-generation";
import { useStoryboardH3VideoBatch } from "./image-workflow/use-storyboard-h3-video-batch";
import { useStoryboardAssetBinding } from "./use-storyboard-asset-binding";
import { useChapterPipelineOrchestrator } from "./useChapterPipelineOrchestrator";

export function StudioView() {
  const viewModel = useStudioViewModel();
  // 文档弹窗(09-13:环节节点「全文」按钮 → NodeDocViewer 老控件重新接线)
  const [docNodeId, setDocNodeId] = useState<string | null>(null);
  const docNode = docNodeId
    ? viewModel.productionFlowNodes.find((n) => n.id === docNodeId)
    : undefined;
  const storyboardBatch = useStoryboardBatchGeneration({
    storyboards: viewModel.chapterStoryboards,
    projectName: viewModel.projectName,
  });
  // H3 出片批量(10-27 双通道通道B;hook 内部自带防休眠/断点续跑/回收轮询)
  const storyboardH3VideoBatch = useStoryboardH3VideoBatch({
    storyboards: viewModel.chapterStoryboards,
  });
  // 导演台 p3 视频导入(1115 实弹 FR,App 侧):引擎 /my_daoyan/chapter_videos 清单
  // →逐镜下载 exports/{章}/{镜}/daoyan-p3.mp4 →updateStoryboard 挂当前视频;
  // unmatched 不落库只报告(D-1:章自动视频 continuityPolicy=required,自动新增
  // 无 continuityState 的分镜会毒化整章编译)。最小面:busy+run 两个键。
  const [daoyanImportBusy, setDaoyanImportBusy] = useState(false);
  const daoyanImport = useMemo(
    () => ({
      busy: daoyanImportBusy,
      run: () => {
        if (daoyanImportBusy) return;
        const projectId = viewModel.projectId;
        const chapterId = viewModel.productionEpisodeId;
        if (!projectId || !chapterId) {
          toast.error("请先打开项目并选择生产章节,再导入导演台视频");
          return;
        }
        setDaoyanImportBusy(true);
        void importDaoyanChapterVideos({
          chapterId,
          projectId,
          storyboards: viewModel.chapterStoryboards,
        })
          .then((result) => {
            const summary = [`已导入 ${result.updated} 镜`];
            if (result.unchanged > 0) summary.push(`${result.unchanged} 镜同片已跳过`);
            if (result.skippedUnmatched.length > 0) {
              summary.push(
                `${result.skippedUnmatched.length} 个引擎片未匹配本章分镜(${result.skippedUnmatched
                  .map((row) => row.segId)
                  .slice(0, 3)
                  .join("、")}${result.skippedUnmatched.length > 3 ? "等" : ""})`,
              );
            }
            if (result.failed.length > 0) summary.push(`${result.failed.length} 镜失败`);
            if (result.failed.length > 0) toast.warning(`导演台视频导入:${summary.join(",")}`);
            else {
              toast.success(`导演台视频导入:${summary.join(",")}`);
              toast.info("已导入的镜需重新视觉审核后方可入章成片");
            }
          })
          .catch((error: unknown) => {
            toast.error(`导演台视频导入失败:${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => setDaoyanImportBusy(false));
      },
    }),
    [daoyanImportBusy, viewModel.projectId, viewModel.productionEpisodeId, viewModel.chapterStoryboards],
  );
  // 分镜素材自动绑定(10-11 批4):面板按钮+例外清单注入
  const storyboardAssetBinding = useStoryboardAssetBinding(viewModel.chapterStoryboards);
  // H3 盘上孤儿导入/存量回流(1120 分镜面板退役迁引擎,原面板两钮的宿主落点;
  // 节点按钮形态=单步直做,结果 toast 报告——候选挂载非破坏,面板两步确认降级)
  const [h3ImportBusy, setH3ImportBusy] = useState(false);
  const h3OrphanTools = useMemo(
    () => ({
      busy: h3ImportBusy,
      importOrphans: () => {
        if (h3ImportBusy) return;
        const projectId = viewModel.projectId;
        if (!projectId) {
          toast.error("请先打开回写目标项目");
          return;
        }
        setH3ImportBusy(true);
        void (async () => {
          try {
            const result = await scanH3OrphanVideos({ projectId, storyboards: viewModel.chapterStoryboards });
            if (result.unmatched.length > 0) {
              toast.info(`另有 ${result.unmatched.length} 组盘上片不属于本章分镜,未导入`);
            }
            const files = result.reports.flatMap((report) => report.orphans);
            if (files.length === 0) {
              toast.info("盘上没有未挂载的 H3 片");
              return;
            }
            const { imported, skipped } = await importH3OrphanVideos({ projectId, storyboards: viewModel.chapterStoryboards, files });
            toast.success(
              `已导入 ${imported} 片 H3 视频为候选(未逐一验播)` + (skipped > 0 ? `,跳过 ${skipped} 片` : ""),
            );
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          } finally {
            setH3ImportBusy(false);
          }
        })();
      },
      // F2⑤ 存量回流:媒体库未挂载远端批量片按镜序↔入库序 1:1 配对挂载
      // (条数不等零挂,宁缺勿错;与面板原实现同链)
      archiveBackfill: () => {
        if (h3ImportBusy) return;
        const projectId = viewModel.projectId;
        if (!projectId) {
          toast.error("请先打开回写目标项目");
          return;
        }
        setH3ImportBusy(true);
        void (async () => {
          try {
            const bridge = getProjectFilesBridge();
            if (!bridge) throw new Error("项目文件桥不可用(仅桌面应用支持存量回流)");
            const reply = await bridge.list({ projectId, relativePath: "media/ai-video" });
            if (!reply.success) throw new Error(reply.error ?? "媒体库视频目录列举失败");
            const mountedRelPaths = new Set(
              useStudioStore
                .getState()
                .videoCandidates.filter((entry) => entry.provider === "h3-comfyui" && typeof entry.filePath === "string")
                .map((entry) => parseProjectFileUrl(entry.filePath as string)?.relativePath)
                .filter((value): value is string => typeof value === "string"),
            );
            const entries = (reply.files ?? [])
              .map((listed) => `media/ai-video/${listed.replace(/\\/g, "/")}`)
              .filter((rel) => {
                const name = rel.split("/").pop() ?? "";
                return /^(full|ambient)_/.test(name) && /\.(mp4|webm|mov|mkv)$/.test(name) && !mountedRelPaths.has(rel);
              })
              .map((rel) => ({ name: rel.split("/").pop() as string, url: buildProjectFileUrl(projectId, rel) }));
            const pendingShots = viewModel.chapterStoryboards.filter((item) => item.mediaRef?.kind !== "video");
            const pairing = pairFireArchiveH3Videos(pendingShots, entries);
            if (pairing.countMismatch || pairing.pairs.length === 0) {
              toast.info(
                `存量回流未执行:媒体库未挂载片 ${entries.length} 片与待挂镜 ${pendingShots.length} 镜条数不等(1:1 宁缺勿错,不盲配)`,
              );
              return;
            }
            const { landed, report } = await landFireArchiveH3Videos(pairing.pairs);
            const mismatched = report.filter((entry) => entry.status === "policy-mismatch").length;
            const already = report.filter((entry) => entry.status === "already-video").length;
            toast.success(
              `存量配对挂载 ${landed} 镜` +
                (mismatched > 0 ? `,${mismatched} 镜政策不符跳过` : "") +
                (already > 0 ? `,${already} 镜已是视频` : ""),
            );
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          } finally {
            setH3ImportBusy(false);
          }
        })();
      },
    }),
    [h3ImportBusy, viewModel.projectId, viewModel.chapterStoryboards],
  );
  // 版本对局部态(1120 单镜动作面迁宿主:引擎 shot-detail 对比钮唤起,
  // 挂点随面板退役迁 StudioView)
  const videoCandidates = useStudioStore((state) => state.videoCandidates);
  const [framesCompareShotId, setFramesCompareShotId] = useState<string | null>(null);
  const [videoCompareShotId, setVideoCompareShotId] = useState<string | null>(null);
  const orderedStoryboards = useMemo(
    () => viewModel.chapterStoryboards.slice().sort((a, b) => a.index - b.index),
    [viewModel.chapterStoryboards],
  );
  const framesCompareShot = framesCompareShotId ? orderedStoryboards.find((item) => item.id === framesCompareShotId) : undefined;
  const videoCompareShot = videoCompareShotId ? orderedStoryboards.find((item) => item.id === videoCompareShotId) : undefined;
  // 章级流水线(10-11 批5):串资产→衍生→绑定;挂载即重启重算(断点续跑);
  // 触发=事件分析完成(本章)或手动;章验收卡横幅落分镜面板
  const chapterPipeline = useChapterPipelineOrchestrator({
    chapterId: viewModel.productionEpisodeId,
    projectId: viewModel.projectId,
    visualManualId: viewModel.workflowConfig.visualManualId,
    storyboards: viewModel.chapterStoryboards,
  });
  // 横幅实况分镜计数(1120 复核⑪):videoReady/ready 是流水线终态卡快照,
  // 会话内 H3 落账不重算卡——横幅按实况 Math.max 兜底,禁以旧卡漏报新就绪。
  const liveStoryboardCounts = useMemo(() => ({
    totalShots: viewModel.chapterStoryboards.length,
    videoReady: viewModel.chapterStoryboards.filter(storyboardHasVideo).length,
    ready: viewModel.chapterStoryboards.filter(storyboardHasVisual).length,
  }), [viewModel.chapterStoryboards]);
  // 漫影侧栏制作动作宿主侧(09-11 旧画布功能迁移收口):运行中防重入
  const sidebarActions = {
    onGenerateImages: () => {
      if (!storyboardBatch.state.running) storyboardBatch.start();
    },
    // 1120 单镜重出桥宿主侧(generate-shot-image,note=shotId):面板退役迁移的
    // 单镜出口补齐——detail.js 动作面「重出本镜」与本地队列提交同路(批量钩
    // onlyShotId 收敛队列到单镜,该镜 force 语义重出,当前画面入库为历史版本)。
    onGenerateShotImage: (shotId?: string) => {
      const id = (shotId ?? "").trim();
      if (!id) return;
      if (!storyboardBatch.state.running) storyboardBatch.start({ onlyShotId: id });
    },
    onGenerateVideos: () => {
      if (!viewModel.chapterAutoVideoRunning) void viewModel.handleRunChapterAutoVideo();
    },
    // 09-12 功能完备(用户终裁:节点功能要像之前):老画布环节动作回流,
    // 走老画布同款派发器 handleProductionNodeAction(付费生成/重建轨道);
    // note=补充要求(09-12 B1:userInstruction 语义,老画布输入框等价)
    onGenerateDirectorPlan: (note?: string) => {
      void viewModel.handleProductionNodeAction({
        id: "generate-director-plan",
        label: "生成导演规划",
        targetStage: "storyboard",
        userInstruction: note ?? "",
      });
    },
    onGenerateStoryboardTable: (note?: string) => {
      void viewModel.handleProductionNodeAction({
        id: "generate-storyboard-table",
        label: "生成分镜表",
        targetStage: "storyboard",
        userInstruction: note ?? "",
      });
    },
    onRebuildWorkbenchTracks: () => {
      void viewModel.handleProductionNodeAction({
        id: "rebuild-workbench-tracks",
        label: "重建视频轨道",
        targetStage: "workbench",
      });
    },
    // 09-13 用户裁定:节点「全文/编辑」回流——老画布文档弹窗(NodeDocViewer
    // +编辑器状态机)重新接线;note=环节 key。
    // 阶段直达型=「详情」:衍生资产→剧本资产阶段;其余型开 NodeDocViewer 全文弹窗。
    // 1120 面板退役:storyboard/storyboardTable/remotionProduction 三型「详情」
    // 兜底回分镜画布(引擎侧已本地开 shot-detail/workbench 浮层不过桥,此分支
    // 仅兜底;原 storyboardPanel 指向随页摘除)
    onViewNodeDoc: (stageKey: string) => {
      if (stageKey === "assets") {
        viewModel.handleStageChange("assets");
        return;
      }
      if (stageKey === "storyboard" || stageKey === "storyboardTable") {
        viewModel.handleStageChange("storyboard");
        return;
      }
      // 工作台→视频工作台页;单镜生产→回分镜画布(引擎详情浮层本地承载)
      if (stageKey === "workbench") {
        viewModel.handleStageChange("workbench");
        return;
      }
      if (stageKey === "remotionProduction") {
        viewModel.handleStageChange("storyboard");
        return;
      }
      setDocNodeId(stageKey);
    },
    onEditNodeDoc: (stageKey: string) => {
      viewModel.openNodeEditor(stageKey as Parameters<typeof viewModel.openNodeEditor>[0]);
    },
    // 09-13 用户裁定:衍生资产节点「抽取资产」——老剧本资产页 AssetsTab
    // 同款钩子(handleEntityExtraction,当前生产章)
    onExtractAssets: () => {
      void viewModel.handleEntityExtraction(viewModel.productionEpisodeId);
    },
    // 1120 分镜面板退役迁引擎:面板批量动作全量回流为节点按钮(hook 本就在
    // StudioView,零搬家——此处只是补触发面)
    onGenerateImagesForce: () => {
      storyboardBatch.start({ forceRegenerate: true });
    },
    onGenerateImagesStop: () => {
      // 常驻钮+运行态不在载荷:非运行态点击 toast 不动作(hook stop 本身幂等)
      if (storyboardBatch.state.running) storyboardBatch.stop();
      else toast.info("批量生图未在运行");
    },
    onH3Start: (tier: string) => {
      storyboardH3VideoBatch.start({ tier: tier === "480p" ? "480p" : "960p" });
    },
    onH3Stop: () => {
      if (storyboardH3VideoBatch.state.running) storyboardH3VideoBatch.stop();
      else toast.info("H3 出片未在运行");
    },
    onH3ImportOrphans: () => {
      h3OrphanTools.importOrphans();
    },
    onH3ArchiveBackfill: () => {
      h3OrphanTools.archiveBackfill();
    },
    // 宿主侧幂等:无成品 finalPath 时提示先合成(handleOpenFinalVideo 自身静默)
    onOpenFinalVideo: () => {
      if (!viewModel.chapterAutoVideoStatus?.finalPath) {
        toast.info("暂无预看成片:请先运行「一键生成所有视频」合成");
        return;
      }
      void viewModel.handleOpenFinalVideo();
    },
    onDaoyanImport: () => {
      daoyanImport.run();
    },
    onChapterPipelineStart: () => {
      chapterPipeline.start();
    },
    onAutoBindAssets: () => {
      storyboardAssetBinding.start();
    },
    // 1120 单镜动作面(引擎 shot-detail 浮层):note=shotId 编码
    onOpenShotImage: (shotId: string) => {
      const shot = viewModel.chapterStoryboards.find((item) => item.id === shotId);
      if (!shot) {
        toast.error(`镜 ${shotId} 不在当前章分镜(章/分片换代?请重开工作流)`);
        return;
      }
      // sourceStage 归一 storyboard(原面板写 storyboardPanel):回跳落分镜画布
      viewModel.openAssetImageWorkflow({
        ...buildStoryboardItemOpenContext(shot),
        sourceStage: "storyboard",
        sourceStageLabel: "分镜画布",
      });
    },
    onCompareFrames: (shotId: string) => {
      setFramesCompareShotId(shotId);
    },
    onCompareVideo: (shotId: string) => {
      setVideoCompareShotId(shotId);
    },
    onKeyframeExtract: (note: string) => {
      // note=shotId|single|<ts> / shotId|uniform|<count>(面板截帧语义同款)
      const [shotId, modeKind, arg] = note.split("|");
      const shot = viewModel.chapterStoryboards.find((item) => item.id === shotId);
      if (!shot) {
        toast.error(`镜 ${shotId} 不在当前章分镜,无法抽帧`);
        return;
      }
      const mode = modeKind === "uniform"
        ? { kind: "uniform" as const, count: (Number(arg) || 3) as 3 | 5 | 9 }
        : { kind: "single" as const, timestampS: Number(arg) || 0 };
      void (async () => {
        const result = await saveVideoFramesAsKeyframes({ projectId: viewModel.projectId, storyboard: shot, mode });
        if (result.ok) toast.success(mode.kind === "single" ? "已存为关键帧" : "已抽帧,本镜关键帧已更新");
        else toast.warning(result.message ?? "抽帧失败");
      })();
    },
    onSetAudioMix: (note: string) => {
      // note=shotId|value(直写 store,章编译音轨同源)
      const [shotId, value] = note.split("|");
      if (!shotId || !value) return;
      useStudioStore.getState().updateStoryboard(shotId, { audioMix: value as StoryboardItem["audioMix"] });
    },
  };

  return (
    <div className="studio-workspace studio-workspace-workflow h-full bg-panel">
      <Tabs
        value={viewModel.activeWorkflowTab}
        onValueChange={viewModel.handleStageChange}
        className="flex h-full flex-col"
      >
      {/* 09-10 终裁:唯一悬浮球上提至 Layout 应用层(全视图在场),
          本视图不再单独挂球 */}
      <ScrollArea className="h-full min-h-0 flex-1 scrollbar-hidden">
          {/* 画布阶段(分镜制作/分镜画布)去内边距贴边全屏;内容阶段保留 p-5 */}
          <div
            className={`flex h-full min-h-0 flex-col bg-background ${
              viewModel.activeWorkflowTab === "storyboard" || viewModel.activeWorkflowTab === "imageWorkflow" ? "p-0" : "p-5"
            }`}
          >
            <TabsContent value="novel" className="m-0">
              <NovelTab
                novelDraft={viewModel.novelDraft}
                setNovelDraft={viewModel.setNovelDraft}
                handleNovelFile={viewModel.handleNovelFile}
                appendNovelText={viewModel.appendNovelText}
                replaceNovelText={viewModel.replaceNovelText}
                novelChapters={viewModel.novelChapters}
                updateNovelChapter={viewModel.updateNovelChapter}
                analyzeEvents={viewModel.handleNovelEventAnalysis}
                sourceBible={viewModel.sourceBible}
                saveSourceBible={viewModel.saveSourceBible}
                generateBibleDraft={viewModel.generateSourceBibleDraft}
              />
            </TabsContent>

            <TabsContent value="manuals" className="m-0">
              <ManualsTab
                workflowConfig={viewModel.workflowConfig}
                setWorkflowConfig={viewModel.setWorkflowConfig}
                manualCatalog={viewModel.manualCatalog}
              />
            </TabsContent>

            <TabsContent value="script" className="m-0">
              <ScriptTab
                novelChapters={viewModel.novelChapters}
                agentWorkData={viewModel.agentWorkData}
                saveAgentWorkData={viewModel.saveAgentWorkData}
                runStage={viewModel.handleScriptStage}
                runReview={viewModel.handleStageReview}
                previewStageUserMessage={viewModel.previewStageUserMessage}
                manualContext={viewModel.scriptStyleSummary}
                directorContext={viewModel.scriptDirectorContext}
                styleSummary={viewModel.scriptStyleSummary}
                scriptStreaming={viewModel.scriptStreaming}
              />
            </TabsContent>

            <TabsContent value="assets" className="m-0">
              <ScriptAssetManagementTab
                novelChapters={viewModel.novelChapters}
                agentWorkData={viewModel.agentWorkData}
                entityExtractions={viewModel.entityExtractions}
                extractAssets={viewModel.handleEntityExtraction}
                updateExtraction={viewModel.saveEntityExtraction}
                productionEpisodeId={viewModel.productionEpisodeId}
                scriptPlanCount={viewModel.scriptPlanCount}
                hasSeriesBible={viewModel.hasSeriesBible}
                derivationNode={viewModel.productionFlowNodes.find(
                  (n) => n.previewKind === "asset-derivation",
                )}
                onOpenAssetImageWorkflow={viewModel.openAssetImageWorkflow}
              />
            </TabsContent>

            <TabsContent
              value="storyboard"
              forceMount
              className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
            >
              <div className="flex h-full min-h-0 flex-1 flex-col">
                {/* 1120 章验收横幅迁画布(面板退役新宿主):画布页在场渲染,
                    props 链=面板原接线同源(pipeline.start/goToAssets/分镜表再生成) */}
                <ChapterAcceptanceBanner
                  run={chapterPipeline.run}
                  staleCount={chapterPipeline.staleTasks.length}
                  staleSourceScriptCount={chapterPipeline.staleSourceScriptCount}
                  liveStoryboardCounts={liveStoryboardCounts}
                  onRunPipeline={chapterPipeline.start}
                  onGoToAssets={() => viewModel.handleStageChange("assets")}
                  onGenerateVideos={() => {
                    // 1120 复核⑩:缺视频的修复入口=章自动出视频(与侧栏 onGenerateVideos
                    // 同源),流水线三步零视频产出清不了该计数。
                    if (!viewModel.chapterAutoVideoRunning) void viewModel.handleRunChapterAutoVideo();
                  }}
                  onRegenerateStoryboardTable={() => {
                    void viewModel.handleProductionNodeAction({
                      id: "generate-storyboard-table",
                      label: "生成分镜表",
                      targetStage: "storyboard",
                      userInstruction: "",
                    });
                  }}
                />
                {/* 09-10 用户裁定:进入工作流阶段即展示本章分镜总览(分镜内容优先);
                    09-11 补裁定:漫影侧栏按模块分内容,工作流模块默认「分镜」页签 */}
                <ComfyCanvasSwap autoOpenOverview myScope="workflow" sidebarActions={sidebarActions} stageFlowNodes={viewModel.productionFlowNodes} />
              </div>
            </TabsContent>

            <TabsContent
              value="imageWorkflow"
              className="m-0 min-h-0 flex-1"
            >
              {/* 分镜画布(资产/单镜图编辑)=分镜生产语境,漫影侧栏默认「分镜」页签 */}
              <ComfyCanvasSwap myScope="workflow" sidebarActions={sidebarActions} stageFlowNodes={viewModel.productionFlowNodes} />
            </TabsContent>

            <TabsContent value="workbench" className="m-0">
              <WorkbenchTab
                projectId={viewModel.projectId}
                projectName={viewModel.projectName}
                episodeId={viewModel.productionEpisodeId}
                directorPlan={viewModel.directorPlan}
                aspectRatio={viewModel.aspectRatio}
                storyboards={viewModel.chapterStoryboards}
                remotionShotSlots={viewModel.remotionShotSlots ?? []}
                onBackToCanvas={() => viewModel.handleStageChange("storyboard")}
              />
            </TabsContent>

          </div>
        </ScrollArea>
      </Tabs>
      {docNode ? (
        <NodeDocViewer
          node={docNode}
          onClose={() => setDocNodeId(null)}
          onEdit={(id) => {
            setDocNodeId(null);
            viewModel.openNodeEditor(id);
          }}
          onEnterStage={(id) => {
            const target = viewModel.productionFlowNodes.find((n) => n.id === id)?.targetStage;
            if (target) viewModel.handleStageChange(target);
          }}
        />
      ) : null}
      {/* 1120 单镜动作面:版本对对话框挂点(引擎 shot-detail 对比钮唤起) */}
      {framesCompareShot ? (
        <ShotImageCompareDialog
          storyboard={framesCompareShot}
          open
          onClose={() => setFramesCompareShotId(null)}
        />
      ) : null}
      {videoCompareShot ? (
        <ShotVideoCompareDialog
          projectId={viewModel.projectId ?? undefined}
          storyboard={videoCompareShot}
          candidates={videoCandidates}
          open
          onClose={() => setVideoCompareShotId(null)}
        />
      ) : null}
      {viewModel.editingWorkflowNodeId && viewModel.workflowNodeEditWritable ? (
        <ScriptEditorDialog
          open
          title={viewModel.workflowNodeEditTitle}
          value={viewModel.workflowNodeDraft}
          onOpenChange={(open) => { if (!open) viewModel.closeNodeEditor(); }}
          onChange={viewModel.setWorkflowNodeDraft}
          onCancel={viewModel.closeNodeEditor}
          onSave={viewModel.saveWorkflowNodeEdit}
        />
      ) : null}
    </div>
  );
}
