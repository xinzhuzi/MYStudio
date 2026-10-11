// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for COMMERCIAL_LICENSE details.
/**
 * scriptAsset 成本估价设置(10-11 pipeline-human-node-automation 批2,G7/G16):
 * 静态估价表 `${providerId}:${model}` → 元/张(与功能绑定键同形,设置页可调)
 * + 单章云端成本上限(默认 ¥10,可调)。护栏的计数口径=张数×估价表
 * (G16:diagnostics 的 cost 是 token 口径,不含异步 job 计费,禁直接用)。
 * 纯本地通道(manying-local-image)恒 ¥0,不进估价表(零计费,G7)。
 * 未配置单价的云端通道按 ¥0 估算并在预估/报表标注「未估价张数」——
 * 不编造单价,护栏只对已估价的通道 fail-closed。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fileStorage } from "@/lib/storage/indexed-db-storage";

/** 单章云端成本上限默认值(元/张口径合计,G7 裁定)。 */
export const DEFAULT_SCRIPT_ASSET_CHAPTER_CAP_CNY = 10;

export interface ScriptAssetCostState {
  /** 估价表:键 `${providerId}:${model}`(与功能绑定键同形)→ 元/张。 */
  prices: Record<string, number>;
  /** 单章云端成本上限(元);0=只允许免费(本地)通道发车。 */
  chapterCapCny: number;
}

export interface ScriptAssetCostActions {
  /** 设/改一条通道单价;price 非法(负数/NaN)时删除该条。 */
  setChannelPrice: (key: string, priceCny: number | null) => void;
  setChapterCapCny: (capCny: number) => void;
}

function sanitizePrices(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, number> = {};
  for (const [key, price] of Object.entries(value as Record<string, unknown>)) {
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) continue;
    next[key] = price;
  }
  return next;
}

function sanitizeCap(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_SCRIPT_ASSET_CHAPTER_CAP_CNY;
}

export const useScriptAssetCostStore = create<ScriptAssetCostState & ScriptAssetCostActions>()(
  persist(
    (set) => ({
      prices: {},
      chapterCapCny: DEFAULT_SCRIPT_ASSET_CHAPTER_CAP_CNY,
      setChannelPrice: (key, priceCny) =>
        set((state) => {
          if (priceCny === null || !Number.isFinite(priceCny) || priceCny < 0) {
            if (!(key in state.prices)) return state;
            const { [key]: _removed, ...rest } = state.prices;
            return { prices: rest };
          }
          return { prices: { ...state.prices, [key]: priceCny } };
        }),
      setChapterCapCny: (capCny) =>
        set({
          chapterCapCny:
            Number.isFinite(capCny) && capCny >= 0
              ? capCny
              : DEFAULT_SCRIPT_ASSET_CHAPTER_CAP_CNY,
        }),
    }),
    {
      name: "mystudio-script-asset-cost",
      storage: createJSONStorage(() => fileStorage),
      merge: (persisted, current) => {
        const persistedState =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<ScriptAssetCostState>)
            : {};
        return {
          ...current,
          prices: sanitizePrices(persistedState.prices),
          chapterCapCny: sanitizeCap(persistedState.chapterCapCny),
        };
      },
    },
  ),
);
