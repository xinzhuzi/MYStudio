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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  COMFY_ENGINE_STAGE_LABELS,
  comfyVersionGithubUrl,
  summarizeDoctorReport,
  type ComfyEngineJob,
} from "./comfy-engine-contract";
import { ComfyEnginePluginBlock } from "./ComfyEnginePluginBlock";
import { ComfyEngineStoragePaths } from "./ComfyEngineStoragePaths";
import { useComfyEngineSettings } from "./useComfyEngineSettings";
import { LocalImageSettingsSection } from "../LocalImageSettingsSection";

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

/** 引擎级任务(install/update/reset)进度条 + 阶段大白话文案。 */
function EngineJobProgress({ job }: { job: ComfyEngineJob }) {
  const failed = job.state === "failed";
  return (
    <div
      className={cn(
        "mt-4 rounded-lg border p-4",
        failed ? "border-destructive/20 bg-destructive/5" : "border-primary/20 bg-primary/5",
      )}
      data-comfy-engine-progress
    >
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className={cn("font-medium", failed ? "text-destructive" : "text-foreground")}>
          {failed
            ? (job.message ?? "任务失败")
            : `${COMFY_ENGINE_STAGE_LABELS[job.stage ?? "download"]}…`}
        </span>
        {!failed && job.progress != null ? (
          <span className="font-mono text-xs text-muted-foreground">{Math.round(job.progress)}%</span>
        ) : null}
      </div>
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

/** 依赖体检报告(正常/缺失/漂移/孤儿)。 */
function DoctorReportCard({
  report,
  onCleanOrphans,
}: {
  report: NonNullable<ReturnType<typeof useComfyEngineSettings>["doctorReport"]>;
  onCleanOrphans?: () => void;
}) {
  const summary = summarizeDoctorReport(report);
  const sections: Array<{ label: string; items: string[] }> = [
    { label: "缺失", items: report.missing },
    { label: "漂移", items: report.drifted },
    { label: "孤儿", items: report.orphan },
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
          {section.label === "孤儿" && onCleanOrphans ? (
            <Button size="sm" variant="outline" className="ml-2 h-6" onClick={onCleanOrphans} data-comfy-clean-orphans>
              清理未登记插件
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
  if (reason === "reset") return "复位前";
  if (reason.startsWith("plugin-install:")) return `安装插件 ${reason.slice("plugin-install:".length)} 前`;
  if (reason.startsWith("plugin-uninstall:")) return `卸载插件 ${reason.slice("plugin-uninstall:".length)} 前`;
  return reason || "手动";
}

export function ComfyEngineSettingsSection({ embedded = false, initialActiveTab }: ComfyEngineSettingsSectionProps) {
  const engine = useComfyEngineSettings();
  const status = engine.status;
  const [modelsDirDraft, setModelsDirDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  // 标签页(照 ComfyUI Desktop 设置布局,09-09 增「模型」页并置首:本地大模型展示)
  const [activeTab, setActiveTab] = useState<ComfyEngineTab>(initialActiveTab ?? "models");
  const [vramDraft, setVramDraft] = useState("");
  const [attentionDraft, setAttentionDraft] = useState("");
  const [reserveDraft, setReserveDraft] = useState("");

  // 深链切页:卡已展开时收到 reveal(如再次点「去更新」)也要切到目标页。
  useEffect(() => {
    if (initialActiveTab) setActiveTab(initialActiveTab);
  }, [initialActiveTab]);

  // 模型目录草稿跟随真实状态(未编辑过时)。
  useEffect(() => {
    setModelsDirDraft((previous) => (previous === "" ? (status?.modelsDir ?? "") : previous));
    setVramDraft((previous) => (previous === "" ? (status?.launchArgs?.vramPolicy ?? "gpu-only") : previous));
    setAttentionDraft((previous) => (previous === "" ? (status?.launchArgs?.attentionMode ?? "pytorch-cross-attention") : previous));
    setReserveDraft((previous) => (previous === "" ? String(status?.launchArgs?.reserveVramGb ?? "16") : previous));
  }, [status?.modelsDir, status?.launchArgs?.vramPolicy, status?.launchArgs?.attentionMode, status?.launchArgs?.reserveVramGb]);

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
  const installFailed = engine.activeJob?.kind === "install" && engine.activeJob.state === "failed";
  const updateFailed = engine.activeJob?.kind === "update" && engine.activeJob.state === "failed";
  // 09-08 实弹修正:status 未知(sidecar 未起/探测未回)≠ 未安装——此前误判
  // 会让已装引擎的用户看到「安装引擎」按钮,以为要重新下载。未知=检查中态。
  const statusUnknown = !status;
  const notInstalled = status?.state === "not-installed";
  // TS 无法从布尔变量回推 activeJob 非空,这里单独收窄。
  const engineJob =
    engine.activeJob !== null && (installing || installFailed || updating || updateFailed || resetting)
      ? engine.activeJob
      : null;

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
            disabled={installing}
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
              disabled={installing}
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

      {/* 安装/更新链/reset 任务进度(含失败大白话) */}
      {engineJob ? <EngineJobProgress job={engineJob} /> : null}

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
                disabled={status.serviceRunning || engine.isStartingService || updating || resetting}
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
                disabled={!status.serviceRunning || updating || resetting}
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
              不复现 09-08 修过的「真空窗空卡」。本地音乐模型已随 music3 收敛
              ComfyUI 云端节点退役(09-09-music3-to-comfyui C 段),本页现管
              图片大模型;后续视频等模态在此加子区。 */}
          {activeTab === "models" ? (
            <div className="space-y-5" data-comfy-models-page>
              <section aria-label="图片大模型" className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">图片大模型(本地生图,免费)</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  大件直接复用 ComfyUI 现成文件零重下,小件首次点击补齐;就绪后在 设置 → 云端AI 把「角色/场景/道具生图」绑定到「本地图片生成」提供方,即可替代云 API。
                </p>
                <LocalImageSettingsSection embedded />
              </section>
            </div>
          ) : null}

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
                      <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning" data-comfy-update-badge>
                        {status.aheadBy != null
                          ? `可更新(+${status.aheadBy} 个新提交)`
                          : status.latest
                            ? `可更新到 ${status.latest}`
                            : "可更新"}
                      </span>
                    ) : status.latest && status.version ? (
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success" data-comfy-up-to-date>
                        已是最新
                      </span>
                    ) : null}
                  </p>
                  {/* shrink-0:不被长版本行文本层盖住点击区(09-09 实弹:elementFromPoint 命中文本 DIV 致按钮点不到) */}
                  {status.updateAvailable ? (
                    <Button size="sm" className="shrink-0" onClick={() => void engine.updateEngine()} disabled={updating}>
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

              <div className="rounded-lg border border-border bg-card/60 p-3">
                <p className="text-xs font-medium text-foreground">PyTorch</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">PyTorch 版本</span>
                  <span className="font-mono text-xs text-foreground" data-comfy-torch>
                    {status?.torch ?? "未记录"}(Apple 芯片 MPS)
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* 启动参数页(照截图行式布局:端口只读+显存策略/加速方式大白话下拉) */}
          {activeTab === "launch" ? (
            <div className="space-y-4" data-comfy-advanced>
          {/* 端口行:只读展示实际端口(17xxx 防撞顺延结果) */}
          <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
            <span className="text-xs text-muted-foreground">服务端口</span>
            <Input
              readOnly
              value={status.port != null ? String(status.port) : "启动后自动分配"}
              containerClassName="w-full min-w-0"
              className="min-w-0 font-mono text-xs"
              data-comfy-port-input
            />
          </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">显存策略</span>
                <select
                  aria-label="显存策略"
                  value={vramDraft === "reserve-vram" ? "gpu-only" : vramDraft || "gpu-only"}
                  onChange={(event) => setVramDraft(event.target.value)}
                  className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                  data-comfy-vram-select
                >
                  <option value="auto">自动(推荐)</option>
                  <option value="gpu-only">全力使用显存</option>
                  <option value="reserve-vram">预留部分显存</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">加速方式</span>
                <select
                  aria-label="加速方式"
                  value={attentionDraft || "pytorch-cross-attention"}
                  onChange={(event) => setAttentionDraft(event.target.value)}
                  className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                  data-comfy-attention-select
                >
                  <option value="auto">自动(推荐)</option>
                  <option value="pytorch-cross-attention">PyTorch 加速</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">预留显存(GB)</span>
                <Input
                  value={reserveDraft}
                  onChange={(event) => setReserveDraft(event.target.value)}
                  placeholder="16"
                  containerClassName="w-28"
                  className="h-8 min-w-0 font-mono text-xs"
                  data-comfy-reserve-input
                />
              </div>
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void engine.setLaunchArgs({
                      vramPolicy: (vramDraft || "gpu-only") as "auto" | "gpu-only" | "reserve-vram",
                      attentionMode: (attentionDraft || "pytorch-cross-attention") as "auto" | "pytorch-cross-attention",
                      reserveVramGb: Number(reserveDraft) > 0 ? Number(reserveDraft) : null,
                    })
                  }
                  data-comfy-advanced-save
                >
                  保存(重启引擎后生效)
                </Button>
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
          {/* 依赖体检:报告 + 核弹复位(二次确认) */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Stethoscope className="h-4 w-4 text-primary" aria-hidden />
                依赖体检
              </p>
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
                  开始体检
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmReset(true)}
                  disabled={resetting}
                  data-comfy-reset-button
                >
                  {resetting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  核弹复位
                </Button>
              </div>
            </div>
            {engine.doctorReport ? (
              <DoctorReportCard report={engine.doctorReport} onCleanOrphans={() => void engine.cleanOrphans()} />
            ) : null}
          </div>

            </div>
          ) : null}

          {/* 存储页:模型目录 + 存储位置四行(源码/venv/工作流;09-09 聚进本页) */}
          {activeTab === "storage" ? (
            <div className="space-y-3">
          {/* 模型目录行:默认 + 自定义路径(指向现有模型库即免重下)+ 打开 */}
          <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
            <span className="text-xs text-muted-foreground">模型目录</span>
            <Input
              value={modelsDirDraft}
              onChange={(event) => setModelsDirDraft(event.target.value)}
              placeholder={status.defaultModelsDir ?? "默认:应用数据目录/comfyui/models"}
              containerClassName="w-full min-w-0"
              className="min-w-0 font-mono text-xs"
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

          {/* 存储位置(源码目录/引擎虚拟环境/工作流目录,可改可迁移) */}
          <ComfyEngineStoragePaths />

            </div>
          ) : null}
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground" data-comfy-status-page>
              正在确认引擎状态,通常几秒内完成;确认后这里会展示版本与更新信息。
            </p>
          )}

          {/* 生态插件子区块(状态未知时不渲染,避免空目录噪音) */}
          {status ? <ComfyEnginePluginBlock engine={engine} /> : null}
        </>
      ) : null}

      {/* 核弹复位二次确认 */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent data-comfy-reset-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>核弹复位引擎运行环境?</AlertDialogTitle>
            <AlertDialogDescription>
              会清空引擎的依赖环境并按账本重建(引擎 + 全部已装插件),期间生图不可用;模型文件和你的工作流不受影响。通常只在体检报告异常、反复装不上时使用。
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
              确认复位
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
