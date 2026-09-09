"use client";

// ComfyUI 引擎卡——生态插件子区块(设置 → 本地配置 → ComfyUI 图像引擎)。
//
// 数据源三层:策展清单 + Registry 搜索合并(catalog)+ 已装清单(plugins);
// 行 = 中文名 + 一句话 + license 徽章 + 胶囊(已装 N 节点/可装/装失败/可更新);
// 行展开 = 作者/下载量/依赖清单 + 安装/卸载/更新;卸载先做工作流引用扫描,
// 「X 个工作流在用它」点名警告后确认;高级折叠 = 任意 git/本地路径安装(第三方警告)。

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  FolderOpen,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  filterComfyCatalogEntries,
  formatComfyPluginPillLabel,
  type ComfyEngineJob,
  type ComfyPluginInfo,
  type ComfyPluginState,
} from "./comfy-engine-contract";
import type { ComfyEngineSettingsController } from "./useComfyEngineSettings";

type ComfyEnginePluginBlockProps = {
  engine: ComfyEngineSettingsController;
};

/** 插件状态胶囊样式(照 PluginSettingsTab PILL_STYLES 语义 token)。 */
const PLUGIN_PILL_STYLES: Record<ComfyPluginState, string> = {
  installed: "border-success/30 bg-success/10 text-success",
  updatable: "border-warning/30 bg-warning/10 text-warning",
  "install-failed": "border-destructive/30 bg-destructive/10 text-destructive",
  installable: "border-border bg-muted/60 text-muted-foreground",
};

/** 列表行的展示模型(已装清单与目录条目归一)。 */
type PluginRow = {
  id: string;
  name: string;
  description: string;
  license: string;
  state: ComfyPluginState;
  nodeCount: number | null;
  author: string | null;
  downloads: number | null;
  category: string | null;
  deps: string[];
  ref: string;
  source: "curated" | "registry" | "git" | "local";
  installed: boolean;
};

function formatDownloads(downloads: number | null): string {
  if (downloads == null) return "未知";
  if (downloads >= 10_000) return `${(downloads / 10_000).toFixed(1)} 万`;
  return String(downloads);
}

type PendingUninstall = {
  plugin: ComfyPluginInfo;
  usage: Array<{ id: string; name: string }>;
};

export function ComfyEnginePluginBlock({ engine }: ComfyEnginePluginBlockProps) {
  const [searchDraft, setSearchDraft] = useState("");
  const [category, setCategory] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<PendingUninstall | null>(null);
  const [isScanningUsage, setIsScanningUsage] = useState(false);
  const [advancedRef, setAdvancedRef] = useState("");

  // 09-09 实弹根修:目录不初始加载,空开时永远「没有匹配的插件」(看起来像坏
  // 了)。挂载即拉一次空搜索——策展清单本地秒回,Registry 离线由后端静默降级。
  const searchCatalogFn = engine.searchCatalog;
  useEffect(() => {
    void searchCatalogFn("");
  }, [searchCatalogFn]);

  const pluginJobActive =
    engine.activeJob?.state === "running" && engine.activeJob.kind.startsWith("plugin");

  const visibleEntries = useMemo(
    () => filterComfyCatalogEntries(engine.catalog, searchDraft, category || null),
    [engine.catalog, searchDraft, category],
  );

  /** 已装插件优先展示,再接目录里的可装条目(去重:已装的以 plugins 清单为准)。 */
  const rows = useMemo<PluginRow[]>(() => {
    const installedIds = new Set(
      engine.plugins.filter((plugin) => plugin.state !== "installable").map((plugin) => plugin.id),
    );
    const catalogRows: PluginRow[] = visibleEntries
      .filter((entry) => !installedIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        license: entry.license,
        state: entry.installedState ?? "installable",
        nodeCount: null,
        author: entry.author,
        downloads: entry.downloads,
        category: entry.category,
        deps: [],
        ref: entry.ref,
        source: entry.source,
        installed: false,
      }));
    const installedRows: PluginRow[] = engine.plugins
      .filter((plugin) => plugin.state !== "installable")
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        license: plugin.license,
        state: plugin.state,
        nodeCount: plugin.nodeCount,
        author: plugin.author,
        downloads: plugin.downloads,
        category: plugin.category,
        deps: plugin.deps,
        ref: plugin.id,
        source: "curated",
        installed: true,
      }));
    return [...installedRows, ...catalogRows];
  }, [engine.plugins, visibleEntries]);

  const requestUninstall = async (row: PluginRow) => {
    setIsScanningUsage(true);
    try {
      const usage = await engine.getPluginUsage(row.id);
      setPendingUninstall({
        plugin: {
          id: row.id,
          name: row.name,
          description: row.description,
          license: row.license,
          state: row.state,
          version: null,
          deps: row.deps,
          author: row.author,
          downloads: row.downloads,
          category: row.category,
          nodeCount: row.nodeCount,
        },
        usage: usage?.workflows ?? [],
      });
    } finally {
      setIsScanningUsage(false);
    }
  };

  const confirmUninstall = async () => {
    if (!pendingUninstall) return;
    const pluginId = pendingUninstall.plugin.id;
    setPendingUninstall(null);
    await engine.uninstallPlugin(pluginId);
  };

  // 区块折叠(09-09 用户裁定):默认收起,显式展开过的记住(localStorage)
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem("comfy-plugin-block-open") === "1";
    } catch {
      return false;
    }
  });
  const toggleOpen = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem("comfy-plugin-block-open", next ? "1" : "0");
    } catch {
      /* 隐私模式等场景静默 */
    }
  };

  return (
    <section aria-label="生态插件" className="space-y-3">
      <Collapsible open={open} onOpenChange={toggleOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/40" data-comfy-plugin-toggle>
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          <PackagePlus className="h-4 w-4 text-primary" aria-hidden />
          <h5 className="text-sm font-semibold text-foreground">生态插件</h5>
          <span className="text-xs text-muted-foreground">
            已装 {engine.plugins.filter((plugin) => plugin.state !== "installable").length} 个
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-1">
          {/* 搜索框 + 分类筛选 */}
          <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchDraft}
            onChange={(event) => {
              setSearchDraft(event.target.value);
              void engine.searchCatalog(event.target.value);
            }}
            placeholder="搜索插件(名字或功能)"
            className="h-8 pl-8 text-xs"
            data-comfy-plugin-search
          />
        </div>
        <select
          aria-label="插件分类"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
          data-comfy-plugin-category
        >
          <option value="">全部分类</option>
          {engine.categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {/* 插件列表行:限高滚动窗口(09-09 用户裁定:全量展开拉长页面致卡,窗口内滑) */}
      <div
        className="max-h-72 divide-y divide-border overflow-y-auto overscroll-contain rounded-lg border border-border"
        data-comfy-plugin-list
      >
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">没有匹配的插件</p>
        ) : null}
        {rows.map((row) => {
          const expanded = expandedId === row.id;
          const pillLabel = formatComfyPluginPillLabel({
            id: row.id,
            name: row.name,
            description: row.description,
            license: row.license,
            state: row.state,
            version: null,
            deps: row.deps,
            author: row.author,
            downloads: row.downloads,
            category: row.category,
            nodeCount: row.nodeCount,
          });
          return (
            <div key={row.id} data-comfy-plugin-row={row.id}>
              <Collapsible open={expanded} onOpenChange={(open) => setExpandedId(open ? row.id : null)}>
                <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      !expanded && "-rotate-90",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{row.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{row.description}</span>
                  </span>
                  <span
                    className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                    data-comfy-plugin-license
                  >
                    {row.license}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      PLUGIN_PILL_STYLES[row.state],
                    )}
                    data-comfy-plugin-pill={row.state}
                  >
                    {pillLabel}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2 border-t border-border/60 bg-muted/20 px-4 py-3">
                    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-3 gap-y-1 text-[11px]">
                      <dt className="text-muted-foreground">作者</dt>
                      <dd className="font-medium text-foreground">{row.author ?? "未知"}</dd>
                      <dt className="text-muted-foreground">下载量</dt>
                      <dd className="font-medium text-foreground">{formatDownloads(row.downloads)}</dd>
                      <dt className="text-muted-foreground">依赖清单</dt>
                      <dd className="break-all font-mono text-foreground">
                        {row.deps.length > 0 ? row.deps.join(", ") : "无额外依赖"}
                      </dd>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      {!row.installed ? (
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={pluginJobActive}
                          onClick={() => void engine.installPlugin(row.source, row.ref)}
                          data-comfy-plugin-install={row.id}
                        >
                          <Download className="mr-1 h-3 w-3" aria-hidden />
                          安装
                        </Button>
                      ) : null}
                      {row.installed && row.state === "updatable" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={pluginJobActive}
                          onClick={() => void engine.updatePlugin(row.id)}
                          data-comfy-plugin-update={row.id}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                          更新
                        </Button>
                      ) : null}
                      {row.installed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={pluginJobActive || isScanningUsage}
                          onClick={() => void requestUninstall(row)}
                          data-comfy-plugin-uninstall={row.id}
                        >
                          <Trash2 className="mr-1 h-3 w-3" aria-hidden />
                          卸载
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </div>

      {/* 插件任务进度(安装五步收尾:克隆→依赖→重启差分) */}
      <PluginJobProgress job={engine.activeJob} />

      {/* 高级折叠:任意 git/本地路径安装(第三方代码警告) */}
      <details className="group rounded-md border border-border" data-comfy-plugin-advanced>
        <summary className="cursor-pointer select-none bg-muted/40 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted">
          高级:从 git 地址或本地路径安装
        </summary>
        <div className="space-y-2 px-3 pb-3 pt-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-4 text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            第三方代码警告:任意来源的插件会以你的权限在本机运行,请只安装可信作者的插件。
          </p>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <Input
              value={advancedRef}
              onChange={(event) => setAdvancedRef(event.target.value)}
              placeholder="https://github.com/作者/插件仓库 或本地插件文件夹路径"
              className="font-mono text-xs"
              data-comfy-plugin-advanced-ref
            />
            <div className="flex gap-2 md:justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const value = advancedRef.trim();
                  if (!value) {
                    toast.error("请先填写 git 地址或本地路径");
                    return;
                  }
                  const source = /^https?:\/\//.test(value) ? "git" : "local";
                  setAdvancedRef("");
                  void engine.installPlugin(source, value);
                }}
                disabled={pluginJobActive}
                data-comfy-plugin-advanced-install
              >
                <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden />
                安装
              </Button>
            </div>
          </div>
        </div>
      </details>
      </CollapsibleContent>
      </Collapsible>

      {/* 卸载引用警告对话框(「X 个工作流在用它」点名;置顶弹窗,不随区块折叠隐藏) */}
      <AlertDialog
        open={pendingUninstall !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUninstall(null);
        }}
      >
        <AlertDialogContent data-comfy-uninstall-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>卸载插件「{pendingUninstall?.plugin.name ?? ""}」?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {pendingUninstall && pendingUninstall.usage.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="flex items-start gap-1.5 font-medium text-warning">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {pendingUninstall.usage.length} 个工作流在用它,卸载后这些工作流会缺节点:
                    </p>
                    <ul className="list-disc pl-6 text-xs text-muted-foreground">
                      {pendingUninstall.usage.map((workflow) => (
                        <li key={workflow.id}>{workflow.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>卸载后会删除插件目录并清理它独占的依赖;没有工作流在用它。</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>先不卸载</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmUninstall()}
            >
              确认卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** 插件任务进行中的阶段提示(装/更/卸共用;大白话,禁英文术语裸奔)。 */
function PluginJobProgress({ job }: { job: ComfyEngineJob | null }) {
  const active = job && job.state === "running" && job.kind.startsWith("plugin") ? job : null;
  if (!active) return null;
  const label =
    active.kind === "plugin-remove"
      ? "正在卸载插件"
      : active.kind === "plugin-update"
        ? "正在更新插件"
        : "正在安装插件";
  return (
    <div className="rounded-lg border border-warning/25 bg-warning/[0.06] p-3" role="status" data-comfy-plugin-job>
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" aria-hidden />
        {label}
        {active.progress != null ? (
          <span className="font-mono text-muted-foreground">{Math.round(active.progress)}%</span>
        ) : null}
      </div>
    </div>
  );
}
