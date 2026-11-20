// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { StudioAssetSummary } from "@/types/studio-assets";

/**
 * 资产详情独立页视图 store(1120-asset-detail-standalone-view §5.2/§10.1):
 * 资产 tab 内「列表↔详情」二态的下钻目标位——双入口(资产库卡片=library /
 * 剧本资产生成 Tab 行=script-tab 跨 tab 跳转)共用同一详情页。
 *
 * 【字段红线(PRD §10.1 钉死勿扩)】本 store 只许三字段:
 * - target:进详情的资产行(空=列表态);
 * - origin:打开来源(返回语义记录;close 后留存供下次,供 script-tab 订阅方
 *   判「关闭的是否本 tab 打开的详情」);
 * - closedAt:最近一次 close 的时戳(script-tab 订阅方据此触发匹配静默刷新;
 *   打开新详情不清零,时戳只增不减)。
 * familyImages/linkedSpeakerIds 等派生数据不入场——真源在详情视图层自取
 * (族图按 asset 键拉取、speaker 键按资产名解析,两入口同键)。
 */
export type AssetDetailOrigin = "library" | "script-tab";

interface AssetDetailViewStore {
  target: StudioAssetSummary | null;
  origin: AssetDetailOrigin | null;
  closedAt: number | null;
  /** 复审 M2 修:script-tab 角色行 id——资产名匹配不上角色库现名时,详情页
   *  linkedSpeakerIds 以 toRoleSpeakerId(sourceRowId) 兜底,保住分配音色的
   *  双写(旧 collectLinkedSpeakerIds fallbackRow 语义回归)。红线放宽为
   *  四字段的唯一例外,勿再加第五个。 */
  sourceRowId: string | null;
  openFromLibrary: (asset: StudioAssetSummary) => void;
  /** 跨 tab 跳转:先切资产 tab 再落 target(PRD §10.1 钉序——tab 先行,宿主
   * 二态渲染时详情页直接就位,避免列表态闪帧);character 行带 row.id 兜底。 */
  openFromScriptTab: (asset: StudioAssetSummary, sourceRowId?: string) => void;
  /** 清 target 记 closedAt;origin 留存(§5.2:记录留存供下次)。 */
  close: () => void;
}

export const useAssetDetailViewStore = create<AssetDetailViewStore>((set) => ({
  target: null,
  origin: null,
  closedAt: null,
  sourceRowId: null,
  openFromLibrary: (asset) => set({ target: asset, origin: "library", sourceRowId: null }),
  openFromScriptTab: (asset, sourceRowId) => {
    useMediaPanelStore.getState().setActiveTab("assets");
    set({ target: asset, origin: "script-tab", sourceRowId: sourceRowId ?? null });
  },
  close: () =>
    set((state) => (state.target ? { target: null, sourceRowId: null, closedAt: Date.now() } : {})),
}));
