"use client";

// Qwen-Image-2.1 加速资产展示(09-24 迁移版:拆行回家,照 09-09 模型页迁入引擎卡
// 与 09-12「件级说明走模型库行内注释」两条房子裁定):
//   · 加速包(viggle-turbo LoRA)= 模型库「模型」页行内注释(comfy-models-taxonomy
//     COMFY_MODEL_FILE_NOTES 的 viggle-turbo 条目)——文件本体就在 loras 分类里
//     列着,注释一句话交代用法,不再单设状态区(09-12 裁定:为一行 LoRA 不值)。
//   · 采样提速插件(TE-Speed)= 本文件的 Qwen21TeSpeedPluginRow,挂在引擎卡
//     「生态插件」区列表尾(ComfyEnginePluginBlock)。
// 旧形态(ComfyEngineSettingsSection 旁的独立 CapabilityRow)09-24 用户裁定退役:
// 「要放入到对应 comfyui 里面」——资产住进引擎卡自己的页,不在外面单开行。
//
// 状态纪律不变:只管在位态,禁假绿(装好且 nodeCount>0 才亮绿;目录在而节点
// 没注册=不可用(MPS));名字带 TE 但接 MODEL 链、不降步数只减每步用时
// (research/02 §二),文案叫「采样提速插件」。启用态不入面板(Q3=A)——
// 启停看画布工作流的 LoRA 槽/开关组。

import { cn } from "@/lib/utils";
import type { ComfyPluginInfo } from "./comfy-engine-contract";
import type { ComfyEngineSettingsController } from "./useComfyEngineSettings";

export type Qwen21TeSpeedState = "checking" | "missing" | "installed" | "unavailable" | "failed";

/** TE-Speed 插件在引擎 custom_nodes 的目录名(台账安装引用)。 */
export const QWEN21_TE_SPEED_PLUGIN_ID = "TE-Speed-QwenImage21";

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

const TE_PILL_LABELS: Record<Qwen21TeSpeedState, string> = {
  checking: "检查中",
  missing: "未装",
  installed: "已装",
  unavailable: "不可用(MPS)",
  failed: "安装失败",
};

/** 绿=就绪、灰=未就绪、红=出错(09-10 主题三色裁定)。 */
const PILL_STYLE_BY_STATE = "border-border bg-muted/60 text-muted-foreground";
const PILL_STYLE_INSTALLED = "border-success/30 bg-success/10 text-success";
const PILL_STYLE_FAILED = "border-destructive/30 bg-destructive/10 text-destructive";

function tePillClass(state: Qwen21TeSpeedState): string {
  if (state === "installed") return PILL_STYLE_INSTALLED;
  if (state === "failed") return PILL_STYLE_FAILED;
  return PILL_STYLE_BY_STATE;
}

const TE_HINTS: Partial<Record<Qwen21TeSpeedState, string>> = {
  missing: "还没装;装好且本机验证通过后才显示已装。",
  unavailable: "插件在,但节点没在本机跑起来(Mac 芯片待验证)。",
  failed: "上次安装没完成;到引擎卡「更新」页重装。",
  checking: "正在读取插件台账…",
};

type Qwen21TeSpeedPluginRowProps = {
  /** 共享引擎控制器(只读插件台账;刷新由所在生态插件区负责)。 */
  engine: ComfyEngineSettingsController;
};

/** 生态插件区列表尾行:采样提速插件(TE-Speed)的在位态。样式与插件行同款。 */
export function Qwen21TeSpeedPluginRow({ engine }: Qwen21TeSpeedPluginRowProps) {
  if (!engine.hasBridge) return null;
  const te = deriveQwen21TeSpeedState(engine.plugins);
  // 已装态零提示行(说明写文件头注释);其余态给一句大白话指引。
  const hint = TE_HINTS[te];
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" data-qwen21-te-row>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">采样提速插件(TE-Speed)</p>
        {hint ? (
          <p className="truncate text-[11px] text-muted-foreground" data-qwen21-te-hint>
            {hint}
          </p>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
          tePillClass(te),
        )}
        data-qwen21-te-pill={te}
      >
        {TE_PILL_LABELS[te]}
      </span>
    </div>
  );
}
