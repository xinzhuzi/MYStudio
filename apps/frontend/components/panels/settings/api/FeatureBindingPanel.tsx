// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Feature Binding Panel (Multi-Select Mode)
 * 品牌分类模型选择
 * 一级：品牌 pill（带 SVG logo + 模型数）
 * 二级：模型列表（checkbox 多选）
 */

import { useMemo, useState } from "react";
import { useAPIConfigStore, type AIFeature } from "@/stores/ai/api-config-store";
import { parseApiKeys } from "@/lib/ai/core";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Link2,
  Check,
  X,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractBrandFromModel, getBrandInfo } from "@/lib/ai/core/providers/brand-mapping";
import { getBrandIcon } from "./brand-icons";
import { getModelDisplayName } from "@/lib/assist/model-display-names";
import {
  FEATURE_CONFIGS,
  isProviderConfiguredForFeature,
  modelSupportsCapability,
  type FeatureMeta,
} from "./feature-binding-domain";

export { FEATURE_CONFIGS, modelSupportsCapability } from "./feature-binding-domain";

/**
 * 供应商选项 - 每个功能可选的平台 + 模型
 */
interface ProviderOption {
  providerId: string;
  platform: string;
  name: string;
  model: string;
  configured: boolean;
}

function getOptionKey(option: ProviderOption): string {
  return `${option.providerId}:${option.model}`;
}

function parseOptionKey(key: string): { providerIdOrPlatform: string; model: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const providerIdOrPlatform = key.slice(0, idx);
  const model = key.slice(idx + 1);
  if (!providerIdOrPlatform || !model) return null;
  return { providerIdOrPlatform, model };
}

export function FeatureBindingPanel() {
  const {
    providers,
    modelTypes,
    modelTags,
    setFeatureBindings,
    toggleFeatureBinding,
    getFeatureBindings,
  } = useAPIConfigStore();
  
  // 跟踪展开/折叠状态
  const [expandedFeatures, setExpandedFeatures] = useState<Set<AIFeature>>(new Set());
  const visibleProviders = useMemo(
    () => providers.filter((provider) => (
      provider.platform !== "memefast" || parseApiKeys(provider.apiKey).length > 0
    )),
    [providers],
  );

  const optionsByFeature = useMemo(() => {
    const map: Partial<Record<AIFeature, ProviderOption[]>> = {};

    for (const feature of FEATURE_CONFIGS) {
      const opts: ProviderOption[] = [];

      for (const provider of visibleProviders) {
        const models = (provider.model || [])
          .map((m) => m.trim())
          .filter((m) => m.length > 0);

        for (const model of models) {
          // 使用平台元数据 (model_type/tags) 进行精确分类
          const mType = modelTypes[model];
          const mTags = modelTags[model];
          if (!modelSupportsCapability(model, provider, feature.requiredCapability, mType, mTags)) continue;
          opts.push({
            providerId: provider.id,
            platform: provider.platform,
            name: provider.name,
            model,
            configured: isProviderConfiguredForFeature(provider, feature),
          });
        }
      }

      // Prefer configured providers first for better UX.
      opts.sort((a, b) => {
        const aConfigured = a.configured;
        const bConfigured = b.configured;
        if (aConfigured !== bConfigured) return aConfigured ? -1 : 1;
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return a.model.localeCompare(b.model);
      });

      map[feature.key] = opts;
    }

    return map;
  }, [visibleProviders, modelTypes, modelTags]);

  // 计算已配置的功能数（至少有一个有效绑定）
  const configuredCount = useMemo(() => {
    return FEATURE_CONFIGS.filter((feature) => {
      const bindings = getFeatureBindings(feature.key);
      if (bindings.length === 0) return false;
      
      // 检查是否至少有一个有效的绑定
      const options = optionsByFeature[feature.key] || [];
      return bindings.some(binding => {
        const parsed = parseOptionKey(binding);
        if (!parsed) return false;
        const option = options.find((o) => getOptionKey(o) === binding || (`${o.platform}:${o.model}` === binding));
        return Boolean(option?.configured);
      });
    }).length;
  }, [optionsByFeature, getFeatureBindings]);

  // 切换单个模型的选中状态
  const handleToggleBinding = (feature: FeatureMeta, optionKey: string) => {
    const parsed = parseOptionKey(optionKey);
    if (!parsed) return;
    toggleFeatureBinding(feature.key, optionKey);
  };
  
  // 切换展开/折叠
  const toggleExpanded = (feature: AIFeature) => {
    setExpandedFeatures(prev => {
      const newSet = new Set(prev);
      if (newSet.has(feature)) {
        newSet.delete(feature);
      } else {
        newSet.add(feature);
      }
      return newSet;
    });
  };

  // 按品牌分组（品牌分类 UI）
  const brandGroupsByFeature = useMemo(() => {
    const result: Partial<Record<AIFeature, Array<{ brandId: string; options: ProviderOption[] }>>> = {};

    for (const feature of FEATURE_CONFIGS) {
      const opts = optionsByFeature[feature.key] || [];
      const brandMap = new Map<string, ProviderOption[]>();

      for (const opt of opts) {
        const brandId = extractBrandFromModel(opt.model);
        if (!brandMap.has(brandId)) brandMap.set(brandId, []);
        brandMap.get(brandId)!.push(opt);
      }

      // 排序：模型数多的品牌在前
      const sorted = [...brandMap.entries()]
        .map(([brandId, options]) => ({ brandId, options }))
        .sort((a, b) => b.options.length - a.options.length);

      result[feature.key] = sorted;
    }

    return result;
  }, [optionsByFeature]);

  // 每个 feature 选中的品牌过滤器
  const [selectedBrand, setSelectedBrand] = useState<Record<string, string | null>>({});
  // 每个 feature 的搜索关键词
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({});

  return (
    <div className="p-6 border border-border rounded-xl bg-card space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          服务映射
        </h3>
        <span className="text-xs text-muted-foreground">
          已配置: {configuredCount}/{FEATURE_CONFIGS.length}
        </span>
      </div>

      {/* Service Mapping Table - Multi-Select */}
      <div className="grid gap-3">
        {FEATURE_CONFIGS.map((feature) => {
          const options = optionsByFeature[feature.key] || [];
          const currentBindings = getFeatureBindings(feature.key);
          const isExpanded = expandedFeatures.has(feature.key);
          const selectableOptionKeys = options
            .filter((o) => o.configured)
            .map((o) => getOptionKey(o));
          const selectedSelectableCount = selectableOptionKeys.filter((k) => currentBindings.includes(k) || currentBindings.includes(`${options.find(o => getOptionKey(o) === k)?.platform}:${options.find(o => getOptionKey(o) === k)?.model}`)).length;
          const isAllSelected =
            selectableOptionKeys.length > 0 && selectedSelectableCount === selectableOptionKeys.length;
          const isPartiallySelected = selectedSelectableCount > 0 && !isAllSelected;
          const isFreedomFeature = feature.key === 'freedom_image' || feature.key === 'freedom_video';
          const handleToggleSelectAll = (checked: boolean | 'indeterminate') => {
            if (checked === true) {
              setFeatureBindings(
                feature.key,
                selectableOptionKeys.length > 0 ? selectableOptionKeys : null
              );
              return;
            }
            setFeatureBindings(feature.key, null);
          };
          
          // 检查有效/失效绑定（失效=模型被过滤、下线，或平台未配置）
          const validBindings: string[] = [];
          const invalidBindings: string[] = [];
          for (const binding of currentBindings) {
            const parsed = parseOptionKey(binding);
            if (!parsed) {
              invalidBindings.push(binding);
              continue;
            }
            const option = options.find((o) => getOptionKey(o) === binding || (`${o.platform}:${o.model}` === binding));
            if (option?.configured) {
              validBindings.push(binding);
            } else {
              invalidBindings.push(binding);
            }
          }
          const configured = validBindings.length > 0;

          return (
            <div
              key={feature.key}
              className={cn(
                "rounded-lg border transition-all",
                configured
                  ? "bg-primary/5 border-primary/30"
                  : "bg-destructive/5 border-destructive/30"
              )}
            >
              {/* Header - Click to expand */}
              <div 
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => toggleExpanded(feature.key)}
              >
                {/* Service Info */}
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className={cn(
                      "p-2 rounded-lg",
                      configured
                        ? "bg-primary/10 text-primary"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {feature.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Label className="font-medium text-foreground cursor-pointer">
                        {feature.name}
                      </Label>
                      {configured ? (
                        <Check className="h-3 w-3 text-primary shrink-0" />
                      ) : (
                        <X className="h-3 w-3 text-destructive shrink-0" />
                      )}
                      {validBindings.length > 0 && (
                        <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                          {validBindings.length} 个模型
                        </span>
                      )}
                      {isFreedomFeature && (
                        <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          可用 {selectableOptionKeys.length}
                        </span>
                      )}
                      {isFreedomFeature && invalidBindings.length > 0 && (
                        <span className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                          暂不可用 {invalidBindings.length}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {feature.description}
                    </p>
                  </div>
                </div>

                {/* Expand/Collapse Icon */}
                <div className="shrink-0">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
              
              {/* Expanded: Brand-categorized model selection */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border/50">
                  {options.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      暂无可选模型（请先在 API 服务商里配置模型列表）
                    </p>
                  ) : (
                    <div className="space-y-3 pt-3">
                      <p className="text-xs text-muted-foreground">
                        可多选，请求将按轮询分配到各模型（间隔 3 秒）
                      </p>

                      {/* 配置提示 */}
                      {feature.recommendation && (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/30">
                          <span className="text-sm font-bold text-red-600 dark:text-red-400 leading-relaxed">
                            {feature.recommendation}
                          </span>
                        </div>
                      )}

                      {isFreedomFeature && invalidBindings.length > 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          检测到暂不可用绑定：系统不会自动清理，模型恢复后会自动继续可用。
                        </p>
                      )}

                      {/* 自由板块一键全选（勾选=全选；取消=全部不选） */}
                      {isFreedomFeature && (
                        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Checkbox
                              checked={isAllSelected ? true : isPartiallySelected ? 'indeterminate' : false}
                              onCheckedChange={handleToggleSelectAll}
                              disabled={selectableOptionKeys.length === 0}
                            />
                            全选模型（取消即全部不选）
                          </label>
                          <span className="text-[11px] text-muted-foreground">
                            {selectedSelectableCount}/{selectableOptionKeys.length}
                          </span>
                        </div>
                      )}

                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="搜索模型名称..."
                          value={searchQuery[feature.key] || ''}
                          onChange={(e) => setSearchQuery(prev => ({ ...prev, [feature.key]: e.target.value }))}
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>

                      {/* Brand Pills */}
                      {(() => {
                        const brands = brandGroupsByFeature[feature.key] || [];
                        const activeBrand = selectedBrand[feature.key] || null;
                        const query = (searchQuery[feature.key] || '').toLowerCase();

                        // 过滤后的模型列表
                        const filteredOptions = options.filter(o => {
                          if (query && !o.model.toLowerCase().includes(query) && !getModelDisplayName(o.model).toLowerCase().includes(query)) return false;
                          if (activeBrand && extractBrandFromModel(o.model) !== activeBrand) return false;
                          return true;
                        });

                        return (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {/* 全部品牌 */}
                              <button
                                type="button"
                                onClick={() => setSelectedBrand(prev => ({ ...prev, [feature.key]: null }))}
                                className={cn(
                                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                                  !activeBrand
                                    ? "bg-primary/10 border-primary/40 text-primary"
                                    : "bg-muted/30 border-border hover:bg-accent/50 text-muted-foreground"
                                )}
                              >
                                全部品牌
                                <span className={cn(
                                  "text-[10px] px-1 py-0.5 rounded-full min-w-[18px] text-center",
                                  !activeBrand ? "bg-primary/20" : "bg-muted"
                                )}>
                                  {options.length}
                                </span>
                              </button>

                              {brands.map(({ brandId, options: brandOpts }) => {
                                const info = getBrandInfo(brandId);
                                const isActive = activeBrand === brandId;
                                return (
                                  <button
                                    key={brandId}
                                    type="button"
                                    onClick={() => setSelectedBrand(prev => ({
                                      ...prev,
                                      [feature.key]: isActive ? null : brandId,
                                    }))}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                                      isActive
                                        ? "bg-primary/10 border-primary/40 text-primary"
                                        : "bg-muted/30 border-border hover:bg-accent/50 text-muted-foreground"
                                    )}
                                  >
                                    <span className="shrink-0">{getBrandIcon(brandId, 14)}</span>
                                    {info.displayName}
                                    <span className={cn(
                                      "text-[10px] px-1 py-0.5 rounded-full min-w-[18px] text-center",
                                      isActive ? "bg-primary/20" : "bg-muted"
                                    )}>
                                      {brandOpts.length}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Model List */}
                            <div className="space-y-1 max-h-[280px] overflow-y-auto">
                              {filteredOptions.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-2 text-center">
                                  无匹配模型
                                </p>
                              ) : (
                                filteredOptions.map((option) => {
                                  const optionKey = getOptionKey(option);
                                  const optionConfigured = option.configured;
                                  const legacyKey = `${option.platform}:${option.model}`;
                                  const isSelected = currentBindings.includes(optionKey) || currentBindings.includes(legacyKey);
                                  const brandId = extractBrandFromModel(option.model);

                                  return (
                                    <label
                                      key={optionKey}
                                      className={cn(
                                        "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors",
                                        isSelected
                                          ? "bg-primary/10 border border-primary/30"
                                          : "hover:bg-accent/50 border border-transparent",
                                        !optionConfigured && "opacity-50"
                                      )}
                                    >
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => handleToggleBinding(feature, optionKey)}
                                        disabled={!optionConfigured}
                                      />
                                      <span className="shrink-0">{getBrandIcon(brandId, 14)}</span>
                                      <span className="text-xs font-mono text-foreground">
                                        {getModelDisplayName(option.model)}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground ml-auto">
                                        {option.name}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status Summary */}
      {configuredCount < FEATURE_CONFIGS.length && (
        <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-destructive">
              部分服务未配置
            </p>
            <p className="text-muted-foreground mt-1">
              请在上方为每个功能选择「供应商/模型」，并确保对应供应商已填写 Base URL；外部服务还需要 API Key。
            </p>
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg space-y-2">
        <p>
          <strong>💡 多模型轮询：</strong>
          每个功能可选择多个模型，请求将按顺序分配到各模型（每次间隔 3 秒），避免单一 API 限流。
        </p>
        <p>
          <strong>📌 说明：</strong>
          可选项来自「API 服务商」里配置的模型列表，点击展开后可多选。
        </p>
      </div>
    </div>
  );
}
