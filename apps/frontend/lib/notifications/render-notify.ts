// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 出片即响(11-06 render-notify):章节/单镜出片完成的系统通知。
// 前台=App 内徽标(use-task-center 既有 recent+bump 数据面,此处零动作);
// 后台=系统通知——Electron 渲染层 Notification(web API 由 Electron 原生实现,
// macOS=通知中心 / Windows=Toast);声音默认关,设置→外观「出片完成提示音」开关。

import { useAppSettingsStore } from "@/stores/app/app-settings-store";

export type RenderCompleteKind = "chapter" | "shot";

const NOTIFICATION_TITLES: Record<RenderCompleteKind, string> = {
  chapter: "章节出片完成",
  shot: "单镜视频完成",
};

/** App 是否处于后台(最小化/被遮挡/失焦)——失焦即视为后台:用户不在看本 App。 */
export function isAppBackgrounded(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState !== "visible" || !document.hasFocus();
}

/**
 * 出片完成系统通知(11-06 钉死范围:只接章节成片与单镜视频两类完成事件):
 * - 前台:不发(悬浮球徽标已兜底),返回 false;
 * - 后台:发系统通知,声音按设置(默认关=silent),返回是否成功发出。
 */
export function notifyRenderComplete(kind: RenderCompleteKind, label: string): boolean {
  if (!isAppBackgrounded()) return false;
  if (typeof Notification === "undefined") return false;
  const sound = useAppSettingsStore.getState().notifications.renderCompleteSound;
  try {
    new Notification(NOTIFICATION_TITLES[kind]!, { body: label, silent: !sound });
    return true;
  } catch {
    return false;
  }
}
