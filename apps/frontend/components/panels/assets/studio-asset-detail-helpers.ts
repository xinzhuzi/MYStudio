// 资产详情视图本地辅助(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出;入口转出口,外部引用零变化)。
"use client";

import type { AssetImageKind } from "@/types/studio-assets";
import { Box, ImageIcon, Map, Music2, UserCircle } from "lucide-react";
import type { AssetType } from "@/lib/ai/prompt-polisher";
import { mapDaojieLibraryAssetType } from "@/lib/ai/daojie-prompt-contract";
import type { StudioAssetKind } from "@/types/studio-assets";
import type { PromptInspectCandidate } from "@/lib/studio/asset-prompt-inspect";
import { getAssetTypeShotProfile } from "@/lib/studio/asset-type-shot";
import type { AssetPromptJsonType } from "@/lib/studio/asset-character-json";

/**
 * 再生成参考图:取当前选中的设定图(全局单选位)作参考,保身份一致性;
 * 无已有图时返回 undefined(纯文生图)。道劫编译链据此装配 reference.denoise 锁。
 */
export function resolveAssetGenerationReferenceImage(
  images: Array<{ url?: string }>,
  currentIndex: number,
): string | undefined {
  return images[currentIndex]?.url || images[0]?.url || undefined;
}

/**
 * 资产库类型 → 生图三轨的唯一映射入口(道劫 ma-gongbi-v1 合同)。
 * clip/audio/任务及未知类型在此 fail-closed,不得默认回落人物或道具轨。
 */
export function resolveThreeTrackAssetType(type: StudioAssetKind): AssetType {
  return mapDaojieLibraryAssetType(type).runtimeTrack;
}

export const TYPE_ICON = {
  role: UserCircle,
  scene: Map,
  tool: Box,
  clip: ImageIcon,
  audio: Music2,
} as const;

export const TYPE_LABEL = {
  role: "角色",
  scene: "场景",
  tool: "道具",
  clip: "视频素材",
  audio: "配音",
} as const;

/**
 * focusKind 是否属 i2i 族(§4.0 参与矩阵):按型出图 i2i 型(型档案 route=i2i)+
 * 高清人头/表情差分两专属 handler 型(虽 i2i 但带型层,与按型 i2i 同族)。
 * i2i 族聚焦时主体句降灰降权折叠、指令卡显型;t2i 族聚焦时指令卡位换「主体句参与」。
 */
export function isI2iFocusKind(kind: AssetImageKind): boolean {
  if (kind === "高清人头" || kind === "表情差分") return true;
  return getAssetTypeShotProfile(kind)?.route === "i2i";
}

/**
 * 主体句降态行文案(i2i 族聚焦时的折叠钮/收起头一行)。通用=单边「走图生图…
 * 主体句不参与」;高清人头例外双路并注(§4.0 矩阵行4:文生图路主体句 ✅ 参与,
 * 图生图路指令即终稿)——文生图入口(onFaceFromText)与零图占位卡分支同样聚焦
 * 本型,单 focusKind 分不出实际走哪路,恒降态单边文案会让文生图路失真
 * (复审修:与型层卡头「仅文生图路注入;图生图路指令即终稿不注型」同款双路口径)。
 */
export function subjectDowngradeNote(kind: AssetImageKind): string {
  if (kind === "高清人头") {
    return "高清人头双路:文生图路主体句参与;图生图路固定指令即终稿";
  }
  return `${kind}走图生图:固定指令锚画面,主体句不参与`;
}

/** 10-24 布局重造批1:基础信息区折叠态记忆键(grill Round 2 B 裁定;缺省展开)。
 * 1120 详情独立页役(§5.3 三令1):区名更名「基础信息」(旧名随弹窗退役,见 git
 * 留痕)——存储键沿旧键 asset-dialog-meta-collapsed(键名语义偏旧系历史留痕,
 * 改名不丢用户既有折叠记忆)。 */
export const META_COLLAPSED_STORAGE_KEY = "asset-dialog-meta-collapsed";

/** 1120 详情独立页役(§5.3 三令2):生图区(preview pane)整区折叠态记忆键
 * (与基础信息区同范式:chevron+标题+计数摘要;缺省展开)。 */
export const GALLERY_COLLAPSED_STORAGE_KEY = "asset-detail-gallery-collapsed";

/** 资产型→提示词真源域型收窄(10-27 接线):真源域只覆盖 role/scene/tool 三轨,
 *  clip/audio 传 undefined(按平铺名探测,与旧角色路语义一致)。 */
export function promptJsonTypeOf(type: StudioAssetKind | undefined): AssetPromptJsonType | undefined {
  return type === "role" || type === "scene" || type === "tool" ? type : undefined;
}

/** 1120 用户令:参考音频路径展示解码——profile 存的 referenceAudioPath 是
 * asset-file:// URI(路径段 percent-encode),原样直出是 %E7%94%B7… 天书;
 * 仅展示层解码(decodeURI 不动 :// 与保留字),存储/传参/引擎解析恒原文。 */
export function displayAudioPath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function readMetaCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(META_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function readGalleryCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(GALLERY_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * ③ 实发终稿探针态(10-25 分层面板役 A-2③):focusKind 组按数组序末位起回溯读
 * tEXt——ready=命中首个携带 tEXt 的该型产物(最近实发);no-products/unreadable/
 * idle/bridge-missing 按 §4.4 降级矩阵置灰注明;probing=回溯读取中。
 */
export type FinalDraftProbe =
  | { status: "idle" }
  | { status: "no-products" }
  | { status: "probing" }
  | { status: "unreadable" }
  | { status: "bridge-missing" }
  | { status: "ready"; candidate: PromptInspectCandidate };

/** ③ 按钮旁小字(probe 态→注明文案;ready=PRD 钉的固定小字;idle 空=R4 砍除提示行)。 */
export const FINAL_DRAFT_NOTE_BY_STATUS: Record<FinalDraftProbe["status"], string> = {
  idle: "",
  "no-products": "该型尚无产物",
  probing: "正在读取该型最近产物…",
  unreadable: "该型最近产物未携带提示词元数据",
  "bridge-missing": "当前环境不支持读取提示词元数据",
  ready: "来自该型最近产物的引擎实收,非本次预演",
};
