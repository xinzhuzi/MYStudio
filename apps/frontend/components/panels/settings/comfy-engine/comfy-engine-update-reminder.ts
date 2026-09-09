// ComfyUI 引擎启动更新提醒(09-08 集成,grill Q10 裁定:「如果有最新的,
// 打开设置界面,提醒更新」)。应用启动后台静默查一次:引擎已装且有新版 →
// toast 提醒 + 点击直达 设置→本地配置→comfy-engine 分区;任何失败静默
// (网络错不打扰),不轮询、仅启动一次。

import { toast } from "sonner";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { getComfyEngineClient } from "./comfy-engine-contract";

/** 设置页分区展开广播(PluginSettingsTab 监听;挂载晚于广播时读 pending 兜底)。 */
export const REVEAL_SETTINGS_SECTION_EVENT = "mystudio:reveal-settings-section";

let pendingRevealSection: { sectionId: string; tab?: string } | null = null;

/** 消费挂起待展开的分区 id(PluginSettingsTab 挂载时调用,防事件早于挂载丢失)。 */
export function consumePendingRevealSection(): { sectionId: string; tab?: string } | null {
  const value = pendingRevealSection;
  pendingRevealSection = null;
  return value;
}

/** 编程式直达 设置→本地配置→指定分区:切 tab + 请 plugins 页 + 展开分区行。
 *  tab 为可选的引擎卡目标标签页(如更新提醒传 "update",展开后直落该页)。 */
export function openSettingsSection(sectionId: string, tab?: string): void {
  const navigation = useMediaPanelStore.getState();
  navigation.setActiveTab("settings");
  navigation.requestSettingsTab("plugins");
  pendingRevealSection = { sectionId, tab };
  window.dispatchEvent(new CustomEvent(REVEAL_SETTINGS_SECTION_EVENT, { detail: { sectionId, tab } }));
}

/**
 * 启动一次性更新提醒:status(便宜)→ 未安装直接罢手;已安装但缓存里没有
 * 新版标记时再静默 checkUpdate(git ls-remote,权威信源)→ 有新版 toast。
 * 全程 catch 静默——sidecar 缺席/网络失败都不打扰用户。
 */
export async function remindComfyEngineUpdateOnce(): Promise<void> {
  const client = getComfyEngineClient();
  if (!client) return; // 非桌面环境没有引擎托管,无事可提醒
  try {
    const status = await client.getEngineStatus();
    if (!status.installed) return;
    const check = status.updateAvailable
      ? { current: status.version, latest: status.latest, updateAvailable: true }
      : await client.checkUpdate();
    if (!check.updateAvailable) return;
    toast.info("ComfyUI 引擎有新版本", {
      description: check.latest ? `可更新到 ${check.latest}(当前 ${check.current ?? "未知"})` : undefined,
      action: { label: "去更新", onClick: () => openSettingsSection("comfy-engine", "update") },
    });
  } catch {
    // 静默失败(网络错/服务缺席不打扰);仅启动一次,不重试不轮询。
  }
}
