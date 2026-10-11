// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for COMMERCIAL_LICENSE details.
"use client";

/**
 * 成本估价设置小节(10-11 pipeline-human-node-automation 批2,G7/G16):
 * 静态估价表 `${providerId}:${model}` → 元/张(与功能绑定键同形,可调)
 * + 单章云端成本上限(默认 ¥10,可调)。
 * 口径纪律:纯本地通道(manying-local-image)恒 ¥0 零计费;未配置单价的
 * 云端通道按 ¥0 估算并在一键报表标注「未估价张数」——不编造单价,
 * 护栏只对已估价通道 fail-closed(超限未发车不发)。
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Coins } from "lucide-react";
import { useAPIConfigStore, type AIFeature } from "@/stores/ai/api-config-store";
import { DEFAULT_LOCAL_IMAGE_PROVIDER_ID } from "@/stores/ai/api-config-provider-helpers";
import {
  DEFAULT_SCRIPT_ASSET_CHAPTER_CAP_CNY,
  useScriptAssetCostStore,
} from "@/stores/studio/script-asset-cost-store";

/** 三个生图功能(资产生成三行类型 → 生图绑定;顺序=资产生成区类目序)。 */
const IMAGE_FEATURES: Array<{ key: AIFeature; label: string }> = [
  { key: "character_generation", label: "角色生成" },
  { key: "scene_generation", label: "场景生成" },
  { key: "prop_generation", label: "道具生成" },
];

interface ChannelRow {
  key: string;
  featureLabel: string;
  providerLabel: string;
  model: string;
  isLocal: boolean;
}

export function CostEstimateSettingsSection() {
  const { prices, chapterCapCny, setChannelPrice, setChapterCapCny } = useScriptAssetCostStore();
  const providers = useAPIConfigStore((state) => state.providers);
  const getFeatureBindings = useAPIConfigStore((state) => state.getFeatureBindings);

  const channelRows = useMemo<ChannelRow[]>(() => {
    const rows: ChannelRow[] = [];
    for (const feature of IMAGE_FEATURES) {
      for (const binding of getFeatureBindings(feature.key)) {
        const idx = binding.indexOf(":");
        if (idx <= 0) continue;
        const providerIdOrPlatform = binding.slice(0, idx);
        const model = binding.slice(idx + 1);
        const provider = providers.find((item) => item.id === providerIdOrPlatform);
        const isLocal =
          providerIdOrPlatform === DEFAULT_LOCAL_IMAGE_PROVIDER_ID ||
          provider?.platform === DEFAULT_LOCAL_IMAGE_PROVIDER_ID;
        rows.push({
          key: binding,
          featureLabel: feature.label,
          providerLabel: provider?.name || providerIdOrPlatform,
          model,
          isLocal,
        });
      }
    }
    return rows;
  }, [getFeatureBindings, providers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold">成本估价</h3>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        「本章资产一键生成」的成本护栏按 张数 × 单价 预估并在发车前逐张拦截（超单章上限不发，
        已完成不回滚）。纯本地通道（漫影本地生图）恒按 ¥0 计费；未配置单价的云端通道按 ¥0 估算，
        跑完报表会标注未估价张数——请为常用云端通道补单价。
      </p>

      <div className="max-w-xs space-y-2">
        <Label htmlFor="script-asset-chapter-cap">单章云端成本上限（元，默认 {DEFAULT_SCRIPT_ASSET_CHAPTER_CAP_CNY}）</Label>
        <Input
          id="script-asset-chapter-cap"
          type="number"
          min={0}
          step={1}
          value={chapterCapCny}
          onChange={(event) => {
            const next = Number(event.target.value);
            setChapterCapCny(Number.isFinite(next) && next >= 0 ? next : chapterCapCny);
          }}
        />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium">生图通道单价表（元/张）</h4>
        {channelRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            尚未绑定生图通道——先到「模型映射」为角色/场景/道具生成绑定模型，再回来填单价。
          </p>
        ) : (
          <div className="space-y-2">
            {channelRows.map((row) => {
              const price = prices[row.key];
              return (
                <div
                  key={`${row.featureLabel}:${row.key}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{row.providerLabel}</span>
                      <span className="text-muted-foreground">{row.model}</span>
                      {row.isLocal ? <Badge variant="secondary">本地 · 零计费</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {row.featureLabel}通道（绑定键 {row.key}）
                    </div>
                  </div>
                  {row.isLocal ? (
                    <span className="text-sm text-muted-foreground">¥0</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`${row.providerLabel}:${row.model} 单价（元/张）`}
                        className="h-8 w-28"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="未估价"
                        value={price ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (raw.trim() === "") {
                            setChannelPrice(row.key, null);
                            return;
                          }
                          const next = Number(raw);
                          if (!Number.isFinite(next) || next < 0) return;
                          setChannelPrice(row.key, next);
                        }}
                      />
                      <span className="text-xs text-muted-foreground">元/张</span>
                      {price === undefined ? (
                        <span className="text-xs text-destructive/80">未估价（按 ¥0 计）</span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
