// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 模型库组件(09-10 用户裁定:按模块分域展示——图片/视频/声音
 * 域分组,域内再按类别分组,一件模型可多重归属;自引擎卡大文件抽出
 * 成独立子模块,分类法见同目录 comfy-models-taxonomy)。
 *
 * 锚点契约(测试/smoke 依赖):data-comfy-models-page / data-comfy-models-list /
 * data-comfy-model-group-toggle={域:类别} / data-comfy-model-group-files={域:类别}。
 */

import { useState } from "react";
import { ChevronDown, FolderOpen, RefreshCw } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { ComfyModelsReply } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import {
  formatModelSize,
  groupModelsByDomain,
  modelCategoryInfo,
  modelFileNote,
} from "@/components/panels/settings/comfy-engine/comfy-models/comfy-models-taxonomy";
import { cn } from "@/lib/utils";

/** 折叠记忆键(域层与类别层共用,复合键=「域」/「域:类别」) */
const OPEN_GROUPS_STORAGE_KEY = "comfy-model-domain-groups-open";

export interface ComfyModelsLibraryProps {
  /** 引擎清单(未拉到=null);与引擎是否安装/运行无关 */
  reply: ComfyModelsReply | null;
  /** 模型目录(「打开」按钮兜底用清单缺失时的 status 值) */
  modelsDir: string;
  onRefresh: () => void;
}

export function ComfyModelsLibrary({ reply, modelsDir, onRefresh }: ComfyModelsLibraryProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const toggleGroup = (key: string, next: boolean) => {
    setOpenGroups((previous) => {
      const nextGroups = { ...previous, [key]: next };
      try {
        window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(nextGroups));
      } catch {
        /* 隐私模式等场景静默 */
      }
      return nextGroups;
    });
  };

  return (
    <div className="space-y-3" data-comfy-models-page>
      <section aria-label="ComfyUI 模型库" className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-foreground">ComfyUI 模型库(本地大模型统一装载)</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onRefresh}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
              刷新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                void window.electronAPI?.openPath(reply?.modelsDir || modelsDir);
              }}
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden />
              打开
            </Button>
          </div>
        </div>
        {reply === null ? (
          <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            清单尚未取到——进入本页会自动读取;若持续空白,通常几秒内重试即可。
          </p>
        ) : reply.groups.length === 0 ? (
          <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            模型目录还是空的;放入模型或经 ComfyUI 生态获取后,这里会自动列出。
          </p>
        ) : (
          <div className="space-y-1.5" data-comfy-models-list>
            {groupModelsByDomain(reply).map((domainGroup) => {
              const domainOpen = openGroups[domainGroup.domain] ?? false;
              return (
                <div
                  key={domainGroup.domain}
                  className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5"
                  data-comfy-model-domain={domainGroup.domain}
                >
                  <Collapsible open={domainOpen} onOpenChange={(next) => toggleGroup(domainGroup.domain, next)}>
                    <CollapsibleTrigger
                      className="flex w-full items-center gap-1.5 rounded-sm text-left"
                      data-comfy-model-domain-toggle={domainGroup.domain}
                    >
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                          !domainOpen && "-rotate-90",
                        )}
                        aria-hidden
                      />
                      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-xs font-medium text-foreground">
                        <span>{domainGroup.label}</span>
                        <span className="font-normal text-muted-foreground">
                          {domainGroup.fileCount} 件 · {formatModelSize(domainGroup.bytes)}
                          {/* 多重归属件跨域重复计数(SEEDVR2 类),给出说明 */}
                        </span>
                      </span>
                    </CollapsibleTrigger>
                    {/* 域注释单行截断,悬停见全文(单行展示铁律) */}
                    <p
                      className="mt-0.5 pl-5 text-[11px] leading-4 text-muted-foreground/80 truncate"
                      title={domainGroup.info}
                    >
                      {domainGroup.info}
                    </p>
                    <CollapsibleContent>
                      <div className="mt-1 space-y-1 pl-3">
                        {domainGroup.categories.map((categoryGroup) => {
                          const key = `${domainGroup.domain}:${categoryGroup.category}`;
                          const groupOpen = openGroups[key] ?? false;
                          return (
                            <div
                              key={key}
                              className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
                            >
                              <Collapsible open={groupOpen} onOpenChange={(next) => toggleGroup(key, next)}>
                                <CollapsibleTrigger
                                  className="flex w-full items-center gap-1.5 rounded-sm text-left"
                                  data-comfy-model-group-toggle={key}
                                >
                                  <ChevronDown
                                    className={cn(
                                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                                      !groupOpen && "-rotate-90",
                                    )}
                                    aria-hidden
                                  />
                                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-[11px] font-medium text-foreground">
                                    <span>{categoryGroup.category}</span>
                                    <span className="font-normal text-muted-foreground">
                                      {categoryGroup.files.length} 件 · {formatModelSize(categoryGroup.bytes)}
                                    </span>
                                  </span>
                                </CollapsibleTrigger>
                                <p
                                  className="mt-0.5 pl-4 text-[11px] leading-4 text-muted-foreground/80 truncate"
                                  title={modelCategoryInfo(categoryGroup.category)}
                                >
                                  {modelCategoryInfo(categoryGroup.category)}
                                </p>
                                {/* 展开态限高滚动窗口(照插件列表 09-09 裁定) */}
                                <CollapsibleContent>
                                  <ul
                                    className="mt-1 max-h-72 space-y-0.5 overflow-y-auto overscroll-contain pl-4"
                                    data-comfy-model-group-files={key}
                                  >
                                    {categoryGroup.files.map((file) => (
                                      <li
                                        key={file.name}
                                        className="flex items-baseline justify-between gap-2 text-[11px] leading-4"
                                      >
                                        <span className="min-w-0 flex-1 select-text break-all">
                                          <span className="font-mono text-muted-foreground">{file.name}</span>
                                          {modelFileNote(file.name) ? (
                                            <span className="ml-1.5 text-muted-foreground/70">
                                              · {modelFileNote(file.name)}
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="shrink-0 text-muted-foreground/80">
                                          {formatModelSize(file.sizeBytes)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}
            <p className="px-1 text-[11px] text-muted-foreground">
              合计 {reply.groups.reduce((n, g) => n + g.files.length, 0)} 件 · {formatModelSize(reply.totalBytes)}
              (跨域重复的件在多个分组各计一次)
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
