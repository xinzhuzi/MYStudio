"use client";

// ComfyUI 引擎卡——生态插件子区块(设置 → 本地配置 → ComfyUI 引擎)。
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
  updatable: "border-primary/30 bg-primary/10 text-primary",
  "install-failed": "border-destructive/30 bg-destructive/10 text-destructive",
  installable: "border-border bg-muted/60 text-muted-foreground",
};

/** 仓库地址归一(小写、剥 .git 尾与尾斜杠)——目录条目与已装行同源判定
 * (与后端 plugin_manager._normalize_repo 同口径)。 */
function normalizeRepoUrl(repo: string): string {
  return repo.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
}

/** 插件行展示模型(已装清单与目录条目归一)。 */
type PluginRow = {
  id: string;
  name: string;
  description: string;
  license: string;
  state: ComfyPluginState;
  nodeCount: number | null;
  author: string | null;
  /** GitHub 星标(已装行,后台缓存;null 整行不显示)。目录行 null 走下载量。 */
  stars: number | null;
  downloads: number | null;
  /** 当前版本(pyproject 语义版,无则 git 短 sha)/最新版本(GitHub tag 或短 sha)。 */
  version: string | null;
  latestVersion: string | null;
  category: string | null;
  deps: string[];
  ref: string;
  source: "curated" | "registry" | "git" | "local" | "pip";
  installed: boolean;
};

function formatCount(count: number | null): string {
  if (count == null) return "未知";
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)} 万`;
  return String(count);
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

  // 任务闸全局单槽(引擎与插件任务互斥):任何任务进行中都禁用插件操作钮——
  // 引擎更新中点插件安装只会撞「已有任务在进行中」报错(09-19 根修)。
  // 插件任务的进度展示统一在引擎卡卡顶(ComfyEngineSettingsSection),本区块
  // 不再放第二条进度条。
  const jobActive = engine.activeJob?.state === "running";

  const visibleEntries = useMemo(
    () => filterComfyCatalogEntries(engine.catalog, searchDraft, category || null),
    [engine.catalog, searchDraft, category],
  );

  // 09-10 根修:已装行同口径过滤(此前搜索/分类只作用于目录条目,已装恒全量,
  // 搜索框对已装插件表现成「不起作用」)。去重仍按全量已装集,已装插件的
  // 目录孪生不因已装行被过滤掉而以「可安装」回流。
  const visiblePlugins = useMemo(
    () => filterComfyCatalogEntries(engine.plugins, searchDraft, category || null),
    [engine.plugins, searchDraft, category],
  );

  /** 已装插件优先展示,再接目录里的可装条目(去重:已装的以 plugins 清单为准)。 */
  const rows = useMemo<PluginRow[]>(() => {
    // 去重两路:归一化 id(小写)——Registry id(comfyui-manager)与台账目录名
    // (ComfyUI-Manager)大小写不一(09-10 实弹);仓库地址(归一化)——策展 id
    // 与仓库名不一致(ComfyUI-ConditioningKrea2Rebalance vs Rebalance-Pack)时
    // id 永远对不上,已装插件以「可安装」孪生行回流,点安装再撞「目录已存在」
    // (09-19 实弹)。
    const installedPlugins = engine.plugins.filter((plugin) => plugin.state !== "installable");
    const installedIds = new Set(installedPlugins.map((plugin) => plugin.id.toLowerCase()));
    const installedRepos = new Set(
      installedPlugins
        .map((plugin) => (plugin.repo ? normalizeRepoUrl(plugin.repo) : null))
        .filter((repo): repo is string => Boolean(repo)),
    );
    const catalogRows: PluginRow[] = visibleEntries
      .filter((entry) => !installedIds.has(entry.id.toLowerCase()))
      .filter((entry) => {
        const repo = entry.repo ? normalizeRepoUrl(entry.repo) : null;
        return repo === null || !installedRepos.has(repo);
      })
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        license: entry.license,
        state: entry.installedState ?? "installable",
        nodeCount: null,
        author: entry.author,
        stars: null,
        downloads: entry.downloads,
        version: null,
        latestVersion: null,
        category: entry.category,
        deps: [],
        ref: entry.ref,
        source: entry.source,
        installed: false,
      }));
    const installedRows: PluginRow[] = visiblePlugins
      .filter((plugin) => plugin.state !== "installable")
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        license: plugin.license,
        state: plugin.state,
        nodeCount: plugin.nodeCount,
        author: plugin.author,
        stars: plugin.stars ?? null,
        downloads: null,
        version: plugin.version ?? null,
        latestVersion: plugin.latestVersion ?? null,
        category: plugin.category,
        deps: plugin.deps,
        ref: plugin.id,
        source: plugin.source ?? "curated",
        installed: true,
      }));
    return [...installedRows, ...catalogRows];
  }, [engine.plugins, visibleEntries, visiblePlugins]);

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
                      {/* 09-10 裁定:没有的数据整行不显示(不出「未知」);
                          已装行显 GitHub 星标,目录行显下载量 */}
                      {row.author ? (
                        <>
                          <dt className="text-muted-foreground">作者</dt>
                          <dd className="font-medium text-foreground">{row.author}</dd>
                        </>
                      ) : null}
                      {row.stars != null ? (
                        <>
                          <dt className="text-muted-foreground">GitHub 星标</dt>
                          <dd className="font-medium text-foreground">{formatCount(row.stars)}</dd>
                        </>
                      ) : null}
                      {row.downloads != null ? (
                        <>
                          <dt className="text-muted-foreground">下载量</dt>
                          <dd className="font-medium text-foreground">{formatCount(row.downloads)}</dd>
                        </>
                      ) : null}
                      {row.version ? (
                        <>
                          <dt className="text-muted-foreground">当前版本</dt>
                          <dd className="font-mono text-foreground">{row.version}</dd>
                        </>
                      ) : null}
                      {row.latestVersion ? (
                        <>
                          <dt className="text-muted-foreground">最新版本</dt>
                          <dd
                            className={cn(
                              "font-mono",
                              row.state === "updatable" ? "text-warning" : "text-foreground",
                            )}
                          >
                            {row.latestVersion}
                          </dd>
                        </>
                      ) : null}
                      <dt className="text-muted-foreground">依赖清单</dt>
                      <dd className="break-all font-mono text-foreground">
                        {row.deps.length > 0 ? row.deps.join(", ") : "无额外依赖"}
                      </dd>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      {/* 后端已标已装的目录行不给安装钮:真身行由已装清单提供
                          (带更新/卸载);此形态只在已装清单暂未拉到时过渡出现;
                          pip 来源=venv 直装,无目录引用不可再装 */}
                      {!row.installed && row.state !== "installed" && row.source !== "pip" ? (
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={jobActive}
                          onClick={() => {
                            const src = row.source;
                            if (src === "pip") return; // 类型窄化回调内保真(venv 直装无目录引用)
                            void engine.installPlugin(src, row.ref);
                          }}
                          data-comfy-plugin-install={row.id}
                        >
                          <Download className="mr-1 h-3 w-3" aria-hidden />
                          安装
                        </Button>
                      ) : null}
                      {/* 半装残留修复(09-19 实弹:Impact-Pack 目录在/台账无,三个按钮
                          全无成死端):走收编链补登记(不删不重拉),完成后恢复更新/卸载 */}
                      {!row.installed && row.state === "installed" && row.source !== "pip" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={jobActive}
                          title="本地已有此插件但安装记录缺失;点击补全登记,恢复更新与卸载"
                          onClick={() => {
                            const src = row.source;
                            if (src === "pip") return;
                            void engine.installPlugin(src, row.ref);
                          }}
                          data-comfy-plugin-adopt={row.id}
                        >
                          <PackagePlus className="mr-1 h-3 w-3" aria-hidden />
                          修复登记
                        </Button>
                      ) : null}
                      {row.installed && (row.state === "updatable" || row.source === "pip") ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={jobActive}
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
                          disabled={jobActive || isScanningUsage}
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

      {/* 高级折叠:任意 git/本地路径安装(第三方代码警告) */}
      {/* 插件任务进度不在此处展示——统一进度位在引擎卡卡顶(09-19 裁定) */}
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
                disabled={jobActive}
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
