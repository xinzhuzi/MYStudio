"use client";

// ComfyUI 图像引擎卡(设置 → 本地配置 → 基础运行时)。
//
// 自管实例(grill Q1/Q2):漫影工作室托管自己的 ComfyUI,全新下载取最新 release,
// 与用户手装的 ComfyUI Desktop 无关(不接管不修改不绑定)。点击才下载,绝不自动下载。
// 状态机:未安装 → 下载中 x% → 需准备 → 已就绪/可更新;就绪口径=装完即就绪,
// 服务未跑显示「准备运行时」副标。行级胶囊在 PluginSettingsTab 行头(共用 hook)。

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Download,
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
  summarizeDoctorReport,
  type ComfyEngineJob,
} from "./comfy-engine-contract";
import { ComfyEnginePluginBlock } from "./ComfyEnginePluginBlock";
import { useComfyEngineSettings } from "./useComfyEngineSettings";

type ComfyEngineSettingsSectionProps = {
  embedded?: boolean;
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
  onRollback,
  isRollingBack,
}: {
  report: NonNullable<ReturnType<typeof useComfyEngineSettings>["updateReport"]>;
  onRollback: () => void;
  isRollingBack: boolean;
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
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="outline" onClick={onRollback} disabled={isRollingBack}>
          {isRollingBack ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          )}
          回滚到 {report.previousVersion}
        </Button>
      </div>
    </div>
  );
}

/** 依赖体检报告(正常/缺失/漂移/孤儿)。 */
function DoctorReportCard({
  report,
}: {
  report: NonNullable<ReturnType<typeof useComfyEngineSettings>["doctorReport"]>;
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
        </p>
      ))}
    </div>
  );
}

/**
 * ComfyUI 图像引擎配置区块。版本策略=跟随最新 release(grill Q10):检查更新显式点击,
 * 更新永远显式确认;更新链=快照→拉新版→重启→重校验,失败一键回滚。
 */
export function ComfyEngineSettingsSection({ embedded = false }: ComfyEngineSettingsSectionProps) {
  const engine = useComfyEngineSettings();
  const status = engine.status;
  const [modelsDirDraft, setModelsDirDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  // 模型目录草稿跟随真实状态(未编辑过时)。
  useEffect(() => {
    setModelsDirDraft((previous) => (previous === "" ? (status?.modelsDir ?? "") : previous));
  }, [status?.modelsDir]);

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
  const notInstalled = !status || status.state === "not-installed";
  // TS 无法从布尔变量回推 activeJob 非空,这里单独收窄。
  const engineJob =
    engine.activeJob !== null && (installing || installFailed || updating || updateFailed || resetting)
      ? engine.activeJob
      : null;

  return (
    <div className="space-y-4 px-5 py-4">
      <p className="text-xs leading-5 text-muted-foreground">
        漫影工作室托管自己的 ComfyUI 引擎(独立运行环境,与你自己装的 ComfyUI Desktop 互不影响);
        端口自动避让。引擎和插件只在你点击时下载,绝不自动下载。
      </p>

      {/* 未安装:一键安装(体积 GB 级提示) */}
      {notInstalled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs leading-5 text-muted-foreground">
            引擎尚未安装,首次安装约需数 GB 磁盘空间(源码 + 独立依赖环境);模型文件另计。
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

      {/* 更新失败 → 一键回滚 */}
      {updateFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
          <p className="text-xs leading-5 text-destructive">
            更新没成功,引擎当前不可用;可一键回滚到更新前快照。
          </p>
          <Button size="sm" variant="outline" onClick={() => void engine.rollbackUpdate()} disabled={engine.isRollingBack}>
            {engine.isRollingBack ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
            )}
            一键回滚
          </Button>
        </div>
      ) : null}

      {/* 更新链成功报告 */}
      {engine.updateReport ? (
        <UpdateReportCard
          report={engine.updateReport}
          onRollback={() => void engine.rollbackUpdate()}
          isRollingBack={engine.isRollingBack}
        />
      ) : null}

      {status?.installed ? (
        <>
          {/* 服务状态行:就绪副标(服务未跑=「准备运行时」)+ 启停 */}
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
                  : "已安装;服务未启动——点「启动服务」准备运行时,即可在画布使用"}
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

          {/* 版本行:当前版本 + 检查更新 + 更新(显式) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground" data-comfy-version-row>
              当前版本 <span className="font-mono">{status.version ?? "未知"}</span>
              {status.updateAvailable && status.latest ? (
                <span className="ml-2 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                  可更新到 {status.latest}
                </span>
              ) : null}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void engine.checkUpdate()}
                disabled={engine.isCheckingUpdate || updating}
              >
                {engine.isCheckingUpdate ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                )}
                检查更新
              </Button>
              {status.updateAvailable ? (
                <Button size="sm" onClick={() => void engine.updateEngine()} disabled={updating}>
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
            <p className="text-[11px] leading-4 text-muted-foreground md:text-right">
              自动避开占用端口,无需手动设置
            </p>
          </div>

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
          <p className="text-[11px] leading-4 text-muted-foreground">
            可以改成已有模型库的路径(例如你在别的软件里下载过的模型目录),引擎直接复用,不用重新下载几十 GB。
          </p>

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
            <p className="text-[11px] leading-4 text-muted-foreground">
              体检会核对依赖账本(装了什么、版本对不对、有没有残留);核弹复位会清空并按账本重建引擎运行环境,模型文件不受影响。
            </p>
            {engine.doctorReport ? <DoctorReportCard report={engine.doctorReport} /> : null}
          </div>

          {/* 生态插件子区块 */}
          <ComfyEnginePluginBlock engine={engine} />
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
