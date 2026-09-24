"use client";

// Qwen-Image-2.1 加速模块区块(设置 → 本地配置 → ComfyUI 引擎分组;09-24 R23 瘦身版)。
//
// 面板只管加速资产的「在位态」:下载/安装/在位,不代改工作流、不预设必开档
// (09-20 红线:加速件启停=用户操控杆)。「启用状态」不入面板(09-24 grill 定案
// Q3=A)——启没启用看画布工作流的 LoRA 槽/开关组;R26.4 接线定型有真值源后再议。
//
// 两行资产 + 下载进度(进度是 LoRA 行的一个状态,不是独立资产):
//   · 加速包(4 步出图)= viggle-turbo LoRA。在位判据=引擎家 models/loras/ 的
//     文件系统真值(GET /comfy/engine/models → engine_manager.list_models 只读
//     FS,与引擎是否运行无关);viggle r64 件已由加速件试装轮落位,首启如实
//     显示「已装」。
//   · 采样提速插件 = TE-Speed-QwenImage21。判据=插件台账+装时 object_info 差分
//     出的节点数(GET /comfy/plugins → plugin_manager.list_plugins)。名字带 TE
//     但接在 MODEL 链、不降步数只减每步用时(research/02 §二),所以文案叫
//     「采样提速插件」,不叫「文本编码提速插件」。禁假绿:装好且节点注册过
//     (nodeCount>0)才显示已装;目录在而节点没注册=不可用(MPS 待验证)。
//   · 下载进度复用引擎卡既有 job 通道(useComfyEngineSettings.activeJob 轮询),
//     不新造通道;进度条仍只放引擎卡卡顶(09-19 裁定),本区只用胶囊/文本百分比。
//     深排结论(09-24):后端无 LoRA 下载 job 种类,试装轮的 LoRA 走 curl 手动
//     落位——所以「未装」态不放下载按钮(没有可走的通道,点了必报错);资产
//     下载专道接入后把 job kind 加进 QWEN21_LORA_FETCH_JOB_KINDS 即点亮下载中态。
//
// 成功态零统计提示行(09-23 裁定):已装=文件名+大小(资产事实),说明写注释。

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatModelSize } from "./comfy-models/comfy-models-taxonomy";
import type {
  ComfyEngineJob,
  ComfyEngineJobKind,
  ComfyModelsEntry,
  ComfyModelsReply,
  ComfyPluginInfo,
} from "./comfy-engine-contract";
import type { ComfyEngineSettingsController } from "./useComfyEngineSettings";

// ── 状态机(纯函数,独立可测;照 comfy-engine-contract 展示层纯函数模式) ────

export type Qwen21LoraState = "checking" | "missing" | "downloading" | "installed";

export interface Qwen21LoraStatus {
  state: Qwen21LoraState;
  /** 已装时的文件真值(loras 目录相对名+字节;后端只读 FS 给出)。 */
  file: ComfyModelsEntry | null;
  /** downloading 态的百分比(0-100;null=不确定进度,显示不带数字)。 */
  progress: number | null;
}

export type Qwen21TeSpeedState = "checking" | "missing" | "installed" | "unavailable" | "failed";

/** TE-Speed 插件在引擎 custom_nodes 的目录名(台账安装引用)。 */
export const QWEN21_TE_SPEED_PLUGIN_ID = "TE-Speed-QwenImage21";

/**
 * 会为 Qwen-Image-2.1 铺加速资产的 job 种类(「下载中 %」态的点亮开关)。
 * 现状(09-24 深排)如实为空:后端 job 只有引擎/插件六种,无模型下载 kind,
 * 试装轮的 LoRA 经 curl 手动落位不经 job。资产下载专道落地时把新 kind 加进
 * 此集合即可;引擎整装(install)不冒充 LoRA 下载——装引擎期间模型目录尚未
 * 成形,LoRA 行保持检查中/未装,不虚报进度。
 */
export const QWEN21_LORA_FETCH_JOB_KINDS: ReadonlySet<ComfyEngineJobKind> = new Set<ComfyEngineJobKind>([]);

/** viggle-turbo 加速 LoRA 的在位判据:loras 类别内文件名含「viggle」。
 * 官方件 v0.2.1 r256(0924「换最新+清旧」令后唯一在库;历史件外置盘备份);只认
 * viggle 不锁步数/秩,社区变体也如实识别为在位。 */
function findQwen21LoraFile(models: ComfyModelsReply | null | undefined): ComfyModelsEntry | null {
  const group = models?.groups.find((item) => item.category === "loras");
  return group?.files.find((file) => /viggle/i.test(file.name)) ?? null;
}

export function deriveQwen21LoraStatus(
  models: ComfyModelsReply | null | undefined,
  activeJob: ComfyEngineJob | null,
  fetchJobKinds: ReadonlySet<ComfyEngineJobKind> = QWEN21_LORA_FETCH_JOB_KINDS,
): Qwen21LoraStatus {
  const file = findQwen21LoraFile(models);
  if (file) return { state: "installed", file, progress: null };
  const job =
    activeJob != null && activeJob.state === "running" && fetchJobKinds.has(activeJob.kind) ? activeJob : null;
  if (job) return { state: "downloading", file: null, progress: job.progress };
  // 清单没取到(侧车未起/探测未回)= 不知道,不冒充未装。
  if (models == null) return { state: "checking", file: null, progress: null };
  return { state: "missing", file: null, progress: null };
}

export function deriveQwen21TeSpeedState(
  plugins: readonly ComfyPluginInfo[] | null | undefined,
): Qwen21TeSpeedState {
  // 台账清单还没拉到(空/缺)= 不知道;本机引擎台账恒非空,空清单即「未取到」。
  if (!plugins || plugins.length === 0) return "checking";
  const plugin = plugins.find((item) => item.id.toLowerCase() === QWEN21_TE_SPEED_PLUGIN_ID.toLowerCase());
  if (!plugin) return "missing";
  if (plugin.state === "install-failed") return "failed";
  // 禁假绿:目录在册且装时 object_info 差分注册过节点(nodeCount>0)才算已装;
  // 目录在而节点没注册(如 Mac 芯片 MPS 兼容未过)= 不可用,不亮绿。
  if (plugin.nodeCount != null && plugin.nodeCount > 0) return "installed";
  return "unavailable";
}

/** 行级胶囊聚合(检查中 > 下载中 > 已就绪 > 未装齐 > 未安装)。 */
export type Qwen21SectionPillKind = "checking" | "downloading" | "ready" | "partial" | "none";

export function deriveQwen21SectionPill(
  lora: Qwen21LoraStatus,
  te: Qwen21TeSpeedState,
): Qwen21SectionPillKind {
  if (lora.state === "checking" || te === "checking") return "checking";
  if (lora.state === "downloading") return "downloading";
  const loraOk = lora.state === "installed";
  const teOk = te === "installed";
  if (loraOk && teOk) return "ready";
  if (loraOk || teOk) return "partial";
  return "none";
}

// ── 展示(状态 → 胶囊文案/样式;照 PluginSettingsTab PILL_* 语义 token) ─────

const LORA_PILL_LABELS: Record<Qwen21LoraState, string> = {
  checking: "检查中",
  missing: "未装",
  downloading: "下载中",
  installed: "已装",
};

const TE_PILL_LABELS: Record<Qwen21TeSpeedState, string> = {
  checking: "检查中",
  missing: "未装",
  installed: "已装",
  unavailable: "不可用(MPS)",
  failed: "安装失败",
};

/** 绿=就绪、蓝=动作、灰=未就绪、红=出错(09-10 主题三色裁定)。 */
const PILL_STYLE_BY_STATE =
  "border-border bg-muted/60 text-muted-foreground";
const PILL_STYLE_INSTALLED = "border-success/30 bg-success/10 text-success";
const PILL_STYLE_DOWNLOADING = "border-primary/30 bg-primary/10 text-primary";
const PILL_STYLE_FAILED = "border-destructive/30 bg-destructive/10 text-destructive";

function pillClass(state: Qwen21LoraState | Qwen21TeSpeedState): string {
  if (state === "installed") return PILL_STYLE_INSTALLED;
  if (state === "downloading") return PILL_STYLE_DOWNLOADING;
  if (state === "failed") return PILL_STYLE_FAILED;
  return PILL_STYLE_BY_STATE;
}

/** 下载中态的百分比文案(42.4 → 「下载中 42%」;无进度数字只说下载中)。 */
export function formatQwen21DownloadingLabel(progress: number | null): string {
  if (progress == null) return "下载中";
  return `下载中 ${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

type Qwen21SpeedupSectionProps = {
  /** 共享引擎控制器(与行级胶囊同一实例;本区只读其状态,不发任务)。 */
  engine: ComfyEngineSettingsController;
};

export function Qwen21SpeedupSection({ engine }: Qwen21SpeedupSectionProps) {
  const loadModels = engine.loadModels;
  const refreshPlugins = engine.refreshPlugins;

  // 展开即重探(照行级「展开/收起都重探」纪律):模型清单与插件台账各拉一次;
  // 拉不到不阻塞——胶囊停在检查中/未装,不冒充已装。挂载一次性探测,不轮询。
  useEffect(() => {
    void loadModels();
    void refreshPlugins();
  }, [loadModels, refreshPlugins]);

  if (!engine.hasBridge) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground" data-qwen21-speedup-bridge-missing>
        Qwen-Image-2.1 加速模块仅在桌面应用中可用。
      </p>
    );
  }

  const lora = deriveQwen21LoraStatus(engine.models, engine.activeJob);
  const te = deriveQwen21TeSpeedState(engine.plugins);

  return (
    <div className="space-y-2 px-5 pb-4 pt-3" data-qwen21-speedup-section>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border/80">
        {/* 加速包行 */}
        <div className="flex items-center gap-3 px-4 py-2.5" data-qwen21-lora-row>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">加速包(4 步出图)</p>
            {lora.state === "installed" && lora.file ? (
              // 成功态零统计提示行:只给资产事实(文件名+大小),别无话术。
              <p className="mt-0.5 break-all font-mono text-[11px] leading-4 text-muted-foreground">
                {lora.file.name} · {formatModelSize(lora.file.sizeBytes)}
              </p>
            ) : null}
            {lora.state === "missing" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground" data-qwen21-lora-hint>
                还没装;文件放进 ComfyUI 模型目录的 loras 后,这里会自动识别。
              </p>
            ) : null}
            {lora.state === "downloading" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-primary" data-qwen21-lora-progress>
                正在下载,稍候自动变为已装。
              </p>
            ) : null}
            {lora.state === "checking" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">正在读取模型目录…</p>
            ) : null}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              pillClass(lora.state),
            )}
            data-qwen21-lora-pill={lora.state}
          >
            {lora.state === "downloading"
              ? formatQwen21DownloadingLabel(lora.progress)
              : LORA_PILL_LABELS[lora.state]}
          </span>
        </div>

        {/* 采样提速插件行 */}
        <div className="flex items-center gap-3 px-4 py-2.5" data-qwen21-te-row>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">采样提速插件</p>
            {/* 已装态零提示行(说明进文件头注释);其余态给一句大白话指引。 */}
            {te === "missing" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground" data-qwen21-te-hint>
                还没装;装好且本机验证通过后才显示已装。
              </p>
            ) : null}
            {te === "unavailable" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground" data-qwen21-te-unavailable>
                插件在,但节点没在本机跑起来(Mac 芯片待验证)。
              </p>
            ) : null}
            {te === "failed" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground" data-qwen21-te-failed>
                上次安装没完成;到上方 ComfyUI 引擎卡的「更新」页重装。
              </p>
            ) : null}
            {te === "checking" ? (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">正在读取插件台账…</p>
            ) : null}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              pillClass(te),
            )}
            data-qwen21-te-pill={te}
          >
            {TE_PILL_LABELS[te]}
          </span>
        </div>
      </div>
      {/* 启用状态不入面板(Q3=A):启停看画布工作流的 LoRA 槽/开关组,此处不展示。 */}
    </div>
  );
}
