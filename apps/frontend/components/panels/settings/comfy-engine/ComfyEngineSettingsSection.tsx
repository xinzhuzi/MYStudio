"use client";

// ComfyUI 引擎卡(设置 → 本地配置 → ComfyUI 引擎分组)。
//
// 自管实例(grill Q1/Q2):漫影工作室托管自己的 ComfyUI,全新下载取最新 release,
// 与用户手装的 ComfyUI Desktop 无关(不接管不修改不绑定)。点击才下载,绝不自动下载。
// 状态机:未安装 → 下载中 x% → 需准备 → 已就绪/可更新;就绪口径=装完即就绪,
// 服务未跑显示「准备运行时」副标。行级胶囊在 PluginSettingsTab 行头(共用 hook)。

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ServerCog,
  Square,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ComfyModelsLibrary } from "@/components/panels/settings/comfy-engine/comfy-models/ComfyModelsLibrary";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  COMFY_ENGINE_STAGE_LABELS,
  comfyVersionGithubUrl,
  launchArgsWarnings,
  summarizeDoctorReport,
  tokenizeArgsString,
  type ComfyEngineJob,
} from "./comfy-engine-contract";
import { ComfyEnginePluginBlock } from "./ComfyEnginePluginBlock";
import { ComfyEngineStoragePaths } from "./ComfyEngineStoragePaths";
import { useComfyEngineSettings } from "./useComfyEngineSettings";

/** 引擎卡标签页。「模型」为默认页(09-09 用户裁定:本地大模型展示并入引擎卡;
 *  默认落模型页 → 展开卡不再自动触发 GitHub 检查,点「更新」页才查)。 */
export type ComfyEngineTab = "models" | "update" | "launch" | "snapshots" | "storage";

type ComfyEngineSettingsSectionProps = {
  embedded?: boolean;
  /** 深链目标页(「去更新」传 "update");组件已挂载时值变化也会切页。 */
  initialActiveTab?: ComfyEngineTab;
};

const copyPath = async (path: string) => {
  try {
    await navigator.clipboard.writeText(path);
    toast.success("路径已复制");
  } catch {
    toast.error("复制路径失败");
  }
};

/** 任务种类 → 进行中小标题(引擎/插件任务共用同一进度位,09-19 统一裁定)。 */
const JOB_KIND_TITLES: Record<ComfyEngineJob["kind"], string> = {
  install: "正在安装引擎",
  update: "正在更新引擎",
  reset: "正在重装运行环境",
  "plugin-install": "正在安装插件",
  "plugin-update": "正在更新插件",
  "plugin-remove": "正在卸载插件",
  migrate: "正在迁移存储位置",
};

/** 引擎与插件任务(install、update、reset、plugin 三类、migrate)统一进度条
 * + 阶段大白话文案。
 * 09-19 用户裁定:进度条只放卡顶这一个位置——此前引擎任务在卡顶、插件任务在
 * 生态插件折叠区,两处进度不同步,折叠区收起时进度还会整个消失。 */
function EngineJobProgress({ job }: { job: ComfyEngineJob }) {
  const failed = job.state === "failed";
  const detail = failed
    ? (job.message ?? "任务失败")
    : (job.message ?? `${COMFY_ENGINE_STAGE_LABELS[job.stage ?? "download"]}…`);
  return (
    <div
      className={cn(
        "mt-4 rounded-lg border p-4",
        failed ? "border-destructive/20 bg-destructive/5" : "border-primary/20 bg-primary/5",
      )}
      data-comfy-engine-progress
    >
      <div className="flex items-center justify-between gap-4">
        <span
          className={cn(
            "text-xs font-medium",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {JOB_KIND_TITLES[job.kind]}
        </span>
        {!failed && job.progress != null ? (
          <span className="font-mono text-xs text-muted-foreground">{Math.round(job.progress)}%</span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1 text-sm",
          failed ? "font-medium text-destructive" : "font-medium text-foreground",
        )}
      >
        {detail}
      </p>
      {!failed ? (
        job.progress != null ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
            />
          </div>
        ) : (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
          </div>
        )
      ) : null}
    </div>
  );
}

/** 更新链成功报告:版本/节点数变化/插件状态(不兼容点名)。 */
function UpdateReportCard({
  report,
}: {
  report: NonNullable<ReturnType<typeof useComfyEngineSettings>["updateReport"]>;
}) {
  const nodeDelta = report.nodeCountAfter - report.nodeCountBefore;
  return (
    <div
      className="mt-4 rounded-lg border border-success/25 bg-success/[0.06] p-4 text-sm"
      data-comfy-update-report
    >
      <p className="font-medium text-foreground">
        已更新:{report.previousVersion} → {report.newVersion}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        节点总数 {report.nodeCountBefore} → {report.nodeCountAfter}(
        {nodeDelta >= 0 ? `+${nodeDelta}` : nodeDelta});{report.compatiblePlugins} 个插件校验兼容。
      </p>
      {report.incompatiblePlugins.length > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          以下插件与新版本不兼容,需要等作者适配:{report.incompatiblePlugins.join("、")}
        </p>
      ) : null}
      {/* 09-09 用户裁定:更新链不做快照,无「一键回滚」;失败重新点更新即从断点自愈 */}
    </div>
  );
}

/** 引擎检查报告(正常/缺了/版本不对/多余没登记)。 */
function DoctorReportCard({
  report,
  onCleanOrphans,
}: {
  report: NonNullable<ReturnType<typeof useComfyEngineSettings>["doctorReport"]>;
  onCleanOrphans?: () => void;
}) {
  const summary = summarizeDoctorReport(report);
  const sections: Array<{ label: string; items: string[] }> = [
    { label: "缺了没装上", items: report.missing },
    { label: "版本不对", items: report.drifted },
    { label: "多余没登记", items: report.orphan },
  ].filter((section) => section.items.length > 0);
  return (
    <div
      className={cn(
        "mt-3 rounded-lg border p-4 text-sm",
        summary.healthy ? "border-success/25 bg-success/[0.06]" : "border-warning/25 bg-warning/[0.06]",
      )}
      data-comfy-doctor-report
    >
      <p className={cn("font-medium", summary.healthy ? "text-success" : "text-warning")}>
        {summary.summary}
      </p>
      {sections.map((section) => (
        <p key={section.label} className="mt-1 text-xs leading-5 text-muted-foreground">
          {section.label}:{section.items.join("、")}
          {section.label === "多余没登记" && onCleanOrphans ? (
            <Button size="sm" variant="outline" className="ml-2 h-6" onClick={onCleanOrphans} data-comfy-clean-orphans>
              清理多余
            </Button>
          ) : null}
        </p>
      ))}
    </div>
  );
}

/**
 * ComfyUI 引擎配置区块。版本策略=跟随最新 release(grill Q10):检查更新显式点击,
 * 更新永远显式确认;更新链=快照→拉新版→重启→重校验,失败一键回滚。
 */
/** 快照原因 → 大白话(快照区展示,design 映射表「快照页→搬并强化」)。 */
function snapshotReasonLabel(reason: string): string {
  if (reason === "update") return "更新引擎前";
  if (reason === "reset") return "彻底重装前";
  if (reason.startsWith("plugin-install:")) return `安装插件 ${reason.slice("plugin-install:".length)} 前`;
  if (reason.startsWith("plugin-uninstall:")) return `卸载插件 ${reason.slice("plugin-uninstall:".length)} 前`;
  return reason || "手动";
}

/** 模型类别/件级注释与域分类法已迁至 comfy-models/comfy-models-taxonomy(09-10 分域裁定)。 */

export function ComfyEngineSettingsSection({ embedded = false, initialActiveTab }: ComfyEngineSettingsSectionProps) {
  const engine = useComfyEngineSettings();
  const status = engine.status;
  const [modelsDirDraft, setModelsDirDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  // 启动参数 Desktop 化(09-10):串=唯一真源;草稿 null=跟随真实状态,编辑后本地持有
  const [argsDraft, setArgsDraft] = useState<string | null>(null);
  // 深审 C2:环境表行=稳定 id 数组(对象键当 React key 会逐字符失焦+行跳动)
  const [envDraft, setEnvDraft] = useState<Array<{ id: number; key: string; value: string }> | null>(null);
  const [envReveal, setEnvReveal] = useState<Record<number, boolean>>({});
  // 标签页(照 ComfyUI Desktop 设置布局,09-09 增「模型」页并置首:本地大模型展示)
  const [activeTab, setActiveTab] = useState<ComfyEngineTab>(initialActiveTab ?? "models");
  // 模型分域折叠状态已随组件迁入 comfy-models/ComfyModelsLibrary(09-10)

  // 深链切页:卡已展开时收到 reveal(如再次点「去更新」)也要切到目标页。
  useEffect(() => {
    if (initialActiveTab) setActiveTab(initialActiveTab);
  }, [initialActiveTab]);

  // 模型页首次激活拉一次清单(09-10 用户裁定:模型页展示引擎模型库真实内容;
  // 同日补裁定:来回切页不要频繁刷新——重进标签页不重拉,显式「刷新」按钮兜底,
  // 拉取失败不记次数、下次进入重试)。loadModels 为 hook 内稳定引用,幂等防抖。
  const loadModelsFn = engine.loadModels;
  const modelsAutoLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "models" || modelsAutoLoadedRef.current) return;
    void loadModelsFn().then(
      () => {
        modelsAutoLoadedRef.current = true;
      },
      () => undefined,
    );
  }, [activeTab, loadModelsFn]);

  // 模型目录草稿跟随真实状态(未编辑过时)。
  useEffect(() => {
    setModelsDirDraft((previous) => (previous === "" ? (status?.modelsDir ?? "") : previous));
  }, [status?.modelsDir]);

  // 启动参数 Desktop 化(09-10):串=唯一真源;草稿 null=跟随真实状态
  const effectiveArgs = argsDraft ?? status?.launchArgs ?? "";
  const envRows: Array<{ id: number; key: string; value: string }> =
    envDraft ??
    Object.entries(status?.envVars ?? {}).map(([key, value], index) => ({
      id: index,
      key,
      value,
    }));
  const argsTokenize = tokenizeArgsString(effectiveArgs);
  const argWarnings = launchArgsWarnings(effectiveArgs);

  // 防抖即存(Desktop 式;语法错不存;与落账值相同不存)
  const saveConfigRef = useRef(engine.setLaunchConfig);
  saveConfigRef.current = engine.setLaunchConfig;
  const lastSavedArgsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!argsTokenize.ok) return;
    if (effectiveArgs === (status?.launchArgs ?? "")) return;
    if (lastSavedArgsRef.current === effectiveArgs) return;
    const timer = setTimeout(() => {
      // 深审 W3:accepted 才标记已存;被拒/失败保持未存态,后续编辑或状态刷新会重试
      void saveConfigRef.current({ argsString: effectiveArgs }).then((reply) => {
        if (reply?.accepted) lastSavedArgsRef.current = effectiveArgs;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [effectiveArgs, argsTokenize.ok, status?.launchArgs]);

  const lastSavedEnvRef = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    if (envDraft == null) return; // 只保存用户编辑过的表
    // 行→对象:空行过滤;重名键后行覆盖前行(改键撞名即覆盖,深审 W5 取舍)
    const clean: Record<string, string> = {};
    for (const row of envDraft) {
      if (row.key.trim() && row.value !== "") clean[row.key.trim()] = row.value;
    }
    const cleanJson = JSON.stringify(clean);
    if (cleanJson === JSON.stringify(status?.envVars ?? {})) return;
    if (lastSavedEnvRef.current != null && cleanJson === JSON.stringify(lastSavedEnvRef.current)) return;
    const timer = setTimeout(() => {
      void saveConfigRef.current({ envVars: clean }).then((reply) => {
        if (reply?.accepted) lastSavedEnvRef.current = clean;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [envDraft, status?.envVars]);

  // 更新页激活即自动静默检查一次(照 Comfy Desktop:打开更新页就问一次 GitHub,
  // 结果只进徽章/上次检查时间,不弹 toast)。ref 防重:本组件生命周期内只自动查一次,
  // 之后靠「检查更新」按钮显式刷新。引擎没装不查(无版本可比)。
  const autoCheckedRef = useRef(false);
  const checkUpdateFn = engine.checkUpdate;
  const isCheckingUpdate = engine.isCheckingUpdate;
  useEffect(() => {
    if (activeTab !== "update" || autoCheckedRef.current) return;
    if (!status?.installed || isCheckingUpdate) return;
    autoCheckedRef.current = true;
    void checkUpdateFn({ silent: true });
  }, [activeTab, status?.installed, isCheckingUpdate, checkUpdateFn]);

  if (!engine.hasBridge) {
    return (
      <div
        className={cn(
          "px-5 py-4 text-sm text-muted-foreground",
          !embedded && "rounded-xl border border-border",
        )}
      >
        ComfyUI 引擎配置仅在桌面应用中可用。
      </div>
    );
  }

  const installing = engine.activeJob?.kind === "install" && engine.activeJob.state === "running";
  const updating = engine.activeJob?.kind === "update" && engine.activeJob.state === "running";
  const resetting = engine.activeJob?.kind === "reset" && engine.activeJob?.state === "running";
  const updateFailed = engine.activeJob?.kind === "update" && engine.activeJob.state === "failed";
  // 任务闸是全局单槽(引擎与插件任务互斥):任何任务进行中,两边的操作钮都要
  // 禁下来——此前插件钮只看插件任务、引擎钮只看引擎任务,交错点击才弹
  // 「已有任务在进行中」报错,看起来就像两边不同步(09-19 根修)。
  const anyJobRunning = engine.activeJob?.state === "running";
  // 09-08 实弹修正:status 未知(sidecar 未起/探测未回)≠ 未安装——此前误判
  // 会让已装引擎的用户看到「安装引擎」按钮,以为要重新下载。未知=检查中态。
  const statusUnknown = !status;
  const notInstalled = status?.state === "not-installed";
  // 统一进度位(09-19):卡顶进度条吃下全部任务种类(引擎 install/update/reset
  // + 插件装/更/卸 + 迁移),running/failed 展示;成功态走报告卡,不出进度条。
  const jobForProgress =
    engine.activeJob !== null && (engine.activeJob.state === "running" || engine.activeJob.state === "failed")
      ? engine.activeJob
      : null;
  // (jobForProgress 在上面统一收窄,引擎/插件任务共用卡顶进度位)

  // 模型页节点(两个落点复用):分域分组展示已抽出独立子模块 comfy-models/
  // (09-10 用户裁定:图片/视频/声音域分组+多重归属;分类法单源在同目录 taxonomy)
  // 09-12 深夜裁定:不再单设「漫影功能组件」状态区(为一行 LoRA 不值),
  // 下载配置记录留在后端 loraFiles,件级说明走模型库行内注释(taxonomy)
  const modelsPageNode = (
    <ComfyModelsLibrary
      reply={engine.models}
      modelsDir={status?.modelsDir ?? ""}
      onRefresh={() => void engine.loadModels()}
    />
  );

  return (
    <div className="space-y-4 px-5 py-4">
      {/* 真未安装:一键安装(体积 GB 级提示) */}
      {notInstalled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs leading-5 text-muted-foreground">
            引擎尚未安装(首次约需数 GB 磁盘空间)
          </p>
          <Button
            size="sm"
            onClick={() => void engine.installEngine()}
            disabled={anyJobRunning}
            data-comfy-install-button
          >
            {installing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden />
            )}
            {installing ? "安装中…" : "安装引擎"}
          </Button>
        </div>
      ) : null}

      {/* 引擎真未安装:安装引导之下仍露出模型页(下载完整模型自足路线不依赖引擎) */}
      {notInstalled ? modelsPageNode : null}

      {/* 需准备(装了一半)/出错:大白话 + 继续安装/重试 */}
      {status?.state === "needs-setup" || status?.state === "error" ? (
        <div className="rounded-lg border border-warning/25 bg-warning/[0.06] px-4 py-3">
          <p className="flex items-start gap-1.5 text-sm font-medium text-warning">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {status.message ?? (status.state === "needs-setup" ? "引擎没装完,需要继续安装" : "引擎状态异常")}
          </p>
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void engine.installEngine()}
              disabled={anyJobRunning}
            >
              {installing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              )}
              {status.state === "needs-setup" ? "继续安装" : "重试安装"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 安装/更新/reset/插件任务统一进度(含失败大白话;唯一进度位,09-19 裁定) */}
      {jobForProgress ? <EngineJobProgress job={jobForProgress} /> : null}

      {/* 更新失败 → 重试自愈(09-09 用户裁定:更新链无快照无回滚) */}
      {updateFailed ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
          <p className="text-xs leading-5 text-destructive">
            更新没成功;重新点「更新到最新」会从断点续装(强制拉取是幂等的)。
          </p>
        </div>
      ) : null}

      {/* 更新链成功报告 */}
      {engine.updateReport ? (
        <UpdateReportCard report={engine.updateReport} />
      ) : null}

      {/* 状态未知(sidecar 未起/探测未回):检查中,不误导成未安装。
          09-08 实弹根修:标签栏结构也要照常出现(否则冷启动真空窗里展开卡
          空无一物,用户以为没做逻辑)——未知时页体用占位文案,确认后自动填充。 */}
      {(statusUnknown || status?.installed === true) && !notInstalled ? (
        <>
          {/* 服务状态行:就绪副标(服务未跑=「准备运行时」)+ 启停;未知=转圈占位 */}
          {status ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {status.serviceRunning ? (
                <Check className="h-4 w-4 text-success" aria-hidden />
              ) : (
                <ServerCog className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
              <span
                className={cn("font-medium", status.serviceRunning ? "text-success" : "text-muted-foreground")}
                data-comfy-service-state
              >
                {status.serviceRunning
                  ? `引擎服务运行中(127.0.0.1:${status.port ?? "—"})`
                  : "服务未启动"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void engine.startService()}
                disabled={status.serviceRunning || engine.isStartingService || anyJobRunning}
              >
                {engine.isStartingService ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Play className="mr-2 h-4 w-4" aria-hidden />
                )}
                启动服务
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void engine.stopService()}
                disabled={!status.serviceRunning || anyJobRunning}
              >
                <Square className="mr-2 h-4 w-4" aria-hidden />
                停止
              </Button>
            </div>
          </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span data-comfy-status-unknown>正在确认引擎状态…</span>
            </div>
          )}

          {/* 标签栏(照 ComfyUI Desktop 设置页布局;09-09 增「模型」页并置首) */}
          <div className="flex flex-wrap gap-1 border-b border-border pb-2" data-comfy-tabs>
            {([
              ["models", "模型"],
              ["update", "更新"],
              ["launch", "启动参数"],
              ["snapshots", "快照"],
              ["storage", "存储"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActiveTab(key);
                  if (key === "snapshots") void engine.refreshSnapshots();
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium",
                  activeTab === key
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-comfy-tab={key}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 模型页:本地大模型展示与管理(09-09 用户裁定并入引擎卡)。放在
              status 条件块外——引擎状态未知(sidecar 未起)时模型行照常可看,
              不复现 09-08 修过的「真空窗空卡」。本地作曲线已转 YuE2(画布
              侧),Music3 权重已彻底删除退役(09-20),本页现管
              图片大模型;后续视频等模态在此加子区。 */}
          {activeTab === "models" ? modelsPageNode : null}

          {/* 页体:状态确认后渲染四个标签页;未知=占位(结构先到,内容后到) */}
          {status ? (
            <>
          {/* 更新页(09-09 用户裁定:检查/更新通道/上次检查等运维展示全撤,只留
              「可更新→一键更新」;打开页面仍自动静默查一次 GitHub) */}
          {activeTab === "update" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card/60 p-3" data-comfy-update-block>
                {/* 版本行:当前版本 + 徽章(检查中/可更新/已是最新)+ 可更新时的更新按钮 */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm font-medium text-foreground" data-comfy-version-row>
                    当前版本 <span className="font-mono">{status.version ?? "未知"}</span>
                    {(() => {
                      const url = comfyVersionGithubUrl(status.version);
                      if (!url) return null;
                      return (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-primary/90 hover:bg-primary/10 hover:text-primary"
                          title={url}
                          aria-label="在 GitHub 查看此版本"
                          data-comfy-version-link
                          onClick={() => {
                            void window.appUpdater?.openExternalLink(url);
                          }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          GitHub
                        </button>
                      );
                    })()}
                    {engine.isCheckingUpdate ? (
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground" data-comfy-checking-badge>
                        正在向 GitHub 查询…
                      </span>
                    ) : status.updateAvailable ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" data-comfy-update-badge>
                        {/* 09-11 裁定:已在最新 tag 上时禁「可更新到 X」(X==当前
                            版本的怪相);master 领先数算不出就明说 master 有新提交 */}
                        {status.aheadBy != null
                          ? `可更新(+${status.aheadBy} 个新提交)`
                          : status.latest && status.latest !== status.version
                            ? `可更新到 ${status.latest}`
                            : "master 有新提交"}
                      </span>
                    ) : status.latest && status.version ? (
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success" data-comfy-up-to-date>
                        已是最新
                      </span>
                    ) : null}
                  </p>
                  {/* shrink-0:不被长版本行文本层盖住点击区(09-09 实弹:elementFromPoint 命中文本 DIV 致按钮点不到) */}
                  {status.updateAvailable ? (
                    <Button size="sm" className="shrink-0" onClick={() => void engine.updateEngine()} disabled={anyJobRunning}>
                      {updating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Download className="mr-2 h-4 w-4" aria-hidden />
                      )}
                      更新到最新
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* 09-10 用户裁定:单行横排、压低高度,去重复的「PyTorch」标题层 */}
              <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">PyTorch 版本</span>
                  <span className="font-mono text-xs text-foreground" data-comfy-torch>
                    {status?.torch ?? "未记录"}(Apple 芯片 MPS)
                  </span>
                </div>
              </div>

              {/* 生态插件子区块(09-10 用户裁定:收进「更新」页=引擎版本+插件生态
                  同页管理;其余标签页不再展示;状态未知时不渲染,避免空目录噪音) */}
              <ComfyEnginePluginBlock engine={engine} />
            </div>
          ) : null}

          {/* 启动参数页(09-10 全盘照 ComfyUI Desktop:命令行串唯一真源+环境变量表;
              09-10 晚用户裁定:端口行与快填下拉系串内容的重复展示,全撤——
              端口看页顶引擎状态行(运行中 127.0.0.1:port),参数态看串本身) */}
          {activeTab === "launch" ? (
            <div className="space-y-4" data-comfy-advanced>
              {/* 命令行整串(Desktop 式;语法错红字拒存,大众端口黄字/0.0.0.0 红字放行警告) */}
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">启动参数</span>
                <Input
                  value={effectiveArgs}
                  onChange={(event) => setArgsDraft(event.target.value)}
                  placeholder="--enable-manager --use-pytorch-cross-attention --gpu-only --reserve-vram 16"
                  containerClassName="w-full"
                  className={cn("min-w-0 font-mono text-xs", !argsTokenize.ok && "border-destructive")}
                  data-comfy-args-input
                />
                {!argsTokenize.ok ? (
                  <p className="text-xs text-destructive" data-comfy-args-error>{argsTokenize.error}</p>
                ) : null}
                {argWarnings.map((warning) => (
                  <p
                    key={warning.text}
                    className={cn("text-xs", warning.level === "danger" ? "text-destructive" : "text-warning")}
                    data-comfy-args-warning={warning.level}
                  >
                    {warning.text}
                  </p>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  整串原样透传给引擎;未写 --port 时自动分配冷门端口。改动自动保存,引擎运行中会自动重启生效。
                </p>
              </div>

              {/* 端口冲突策略=托管旋钮,不在串中,零重复故保留 */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">端口被占时</span>
                <select
                  aria-label="端口冲突策略"
                  value={status.portConflictPolicy ?? "auto-shift"}
                  onChange={(event) =>
                    void engine.setLaunchConfig({ portConflictPolicy: event.target.value as "auto-shift" | "fail" })
                  }
                  className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                  data-comfy-port-policy-select
                >
                  <option value="auto-shift">自动换冷门端口</option>
                  <option value="fail">直接报错提醒我</option>
                </select>
              </div>

              {/* 环境变量表(spawn 注入;值默认遮蔽,点击临时显示;行=稳定 id 数组) */}
              <div className="space-y-2" data-comfy-env-vars>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">环境变量</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setEnvDraft([...envRows, { id: Date.now(), key: "", value: "" }])}
                    data-comfy-env-add
                  >
                    添加变量
                  </Button>
                </div>
                {envRows.length === 0 && envDraft == null ? (
                  <p className="text-[11px] text-muted-foreground">暂无变量;常用于 HF_TOKEN、代理地址等(注入引擎进程)。</p>
                ) : null}
                {envRows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] items-center gap-2">
                    <Input
                      value={row.key}
                      onChange={(event) =>
                        setEnvDraft(envRows.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item)))
                      }
                      placeholder="变量名"
                      containerClassName="min-w-0"
                      className="h-8 min-w-0 font-mono text-xs"
                      data-comfy-env-key
                    />
                    <Input
                      type={envReveal[row.id] ? "text" : "password"}
                      value={row.value}
                      onChange={(event) =>
                        setEnvDraft(envRows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)))
                      }
                      placeholder="值"
                      containerClassName="min-w-0"
                      className="h-8 min-w-0 font-mono text-xs"
                      data-comfy-env-value
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEnvReveal((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                      aria-label={envReveal[row.id] ? "隐藏值" : "显示值"}
                    >
                      {envReveal[row.id] ? "隐藏" : "显示"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEnvDraft(envRows.filter((item) => item.id !== row.id))}
                      aria-label="删除变量"
                      data-comfy-env-remove
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 快照页(照截图:快照列表+回滚;体检/复位同住本页=引擎的保险区) */}
          {activeTab === "snapshots" ? (
            <div className="space-y-4">
              <div data-comfy-snapshots>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">快照与回滚</span>
                  <Button size="sm" variant="ghost" onClick={() => void engine.refreshSnapshots()} data-comfy-snapshot-refresh>
                    刷新
                  </Button>
                </div>
                {engine.snapshots.length === 0 ? (
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">暂无快照</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {engine.snapshots.slice(0, 5).map((snap) => (
                      <li key={snap.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {new Date(snap.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          ·{snapshotReasonLabel(snap.reason)}
                          {snap.version ? `(${snap.version})` : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void engine.rollbackTo(snap.id)}
                          disabled={engine.isRollingBack}
                          data-comfy-snapshot-rollback
                        >
                          回滚到此
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-border pt-3" />
          {/* 引擎修复:检查哪里坏了 + 彻底重装(二次确认)——09-10 大白话化,
              原「依赖体检/核弹复位」黑话用户看不懂 */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Stethoscope className="h-4 w-4 text-primary" aria-hidden />
                  引擎修复
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/80 truncate" title="引擎报错、插件装不上时用">
                  引擎报错、插件装不上时:先「开始检查」;反复修不好,才「彻底重装」
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void engine.runDoctor()}
                  disabled={engine.isRunningDoctor}
                >
                  {engine.isRunningDoctor ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Stethoscope className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  开始检查
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmReset(true)}
                  disabled={anyJobRunning}
                  data-comfy-reset-button
                >
                  {resetting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  彻底重装
                </Button>
              </div>
            </div>
            {engine.doctorReport ? (
              <DoctorReportCard report={engine.doctorReport} onCleanOrphans={() => void engine.cleanOrphans()} />
            ) : null}
          </div>

            </div>
          ) : null}

          {/* 存储页(09-10 用户裁定:单一「存储位置」卡,模型目录并入卡内首行,
              卡内零嵌套盒子) */}
          {activeTab === "storage" ? (
            <ComfyEngineStoragePaths
              modelsDirRow={
                <div className="grid items-center gap-2 md:grid-cols-[5rem_minmax(0,1fr)_auto]" data-comfy-path-row="modelsDir">
                  <span className="text-xs text-muted-foreground" title="指向现有模型库即免重下">
                    模型目录
                  </span>
                  {/* 平文本式可编辑输入(无边框无底色,与相邻只读路径同形态) */}
                  <Input
                    value={modelsDirDraft}
                    onChange={(event) => setModelsDirDraft(event.target.value)}
                    placeholder={status.defaultModelsDir ?? "默认:应用数据目录/comfyui/models"}
                    containerClassName="w-full min-w-0"
                    className="h-7 min-w-0 rounded-none border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:ring-0"
                    data-comfy-models-dir-input
                  />
                  <div className="flex flex-nowrap gap-2 md:justify-end">
                    <Button
                      size="sm"
                      onClick={() => void engine.setModelsDir(modelsDirDraft)}
                      disabled={engine.isSavingModelsDir}
                      data-comfy-models-dir-save
                    >
                      {engine.isSavingModelsDir ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Check className="mr-2 h-4 w-4" aria-hidden />
                      )}
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (status.modelsDir) void copyPath(status.modelsDir);
                      }}
                    >
                      <Copy className="mr-1 h-4 w-4" aria-hidden />
                      复制
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void window.electronAPI?.openPath(status.modelsDir ?? "");
                      }}
                    >
                      <FolderOpen className="mr-1 h-4 w-4" aria-hidden />
                      打开
                    </Button>
                  </div>
                </div>
              }
            />
          ) : null}
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground" data-comfy-status-page>
              正在确认引擎状态,通常几秒内完成;确认后这里会展示版本与更新信息。
            </p>
          )}
        </>
      ) : null}

      {/* 彻底重装二次确认 */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent data-comfy-reset-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>彻底重装引擎运行环境?</AlertDialogTitle>
            <AlertDialogDescription>
              会把引擎的运行环境整个删掉重装(引擎 + 你装过的全部插件),期间生图不可用;你的模型文件和工作流不受影响。只在反复修不好的时候用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>先不用</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmReset(false);
                void engine.resetEngine();
              }}
            >
              确认重装
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
