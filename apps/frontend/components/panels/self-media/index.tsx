import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Box,
  Globe2,
  History,
  Layers,
  Loader2,
  Pencil,
  Radio,
  RotateCcw,
  Send,
  Users2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProjectStore } from "@/stores/project/project-store";
import { useSelfMediaStore } from "@/stores/self-media/self-media-store";
import { useProductStore } from "@/stores/product/product-store";
import { useSelfMediaGlobalStore } from "@/stores/self-media/self-media-global-store";
import type { SelfMediaPlatform, SelfMediaProviderSummary, SelfMediaTask } from "@/types/self-media";
import { BatchPublishView } from "./batch-publish-view";
import { TemplateView } from "./template-view";
import { ShowcaseView } from "./showcase-view";
import { ComposeView } from "./compose-view";
import { ProductsView } from "./products-view";
import { getSelfMediaBridge, selfMediaPlatformCapabilities } from "./view-helpers";
import { useSelfMediaLedger } from "./use-self-media-ledger";

type SelfMediaSection = "accounts" | "compose" | "batch" | "tasks" | "history" | "products" | "global" | "templates" | "showcase";

const sections: Array<{ id: SelfMediaSection; label: string; icon: typeof Users2 }> = [
  { id: "accounts", label: "账号", icon: Users2 },
  { id: "compose", label: "发布", icon: Send },
  { id: "batch", label: "全平台", icon: Globe2 },
  { id: "tasks", label: "任务", icon: Radio },
  { id: "history", label: "历史", icon: History },
  { id: "products", label: "产品", icon: Box },
  { id: "templates", label: "模板", icon: Pencil },
  { id: "showcase", label: "展示页", icon: Globe2 },
  { id: "global", label: "全部产品", icon: Layers },
];

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    online: "在线",
    offline: "离线",
    expired: "登录过期",
    error: "异常",
    success: "已发布",
    failure: "失败",
    partial: "部分成功",
    audit: "审核中",
    scheduled: "已排期",
    running: "发布中",
    canceled: "已取消",
    "expired-login": "登录过期",
  };
  return labels[status] ?? status;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success" || status === "online") return "default";
  if (status === "failure" || status === "error" || status === "expired" || status === "expired-login") return "destructive";
  if (status === "running" || status === "scheduled" || status === "audit") return "secondary";
  return "outline";
}

function AccountsView() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const accounts = useSelfMediaStore((state) => state.accounts);
  const setAccounts = useSelfMediaStore((state) => state.setAccounts);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<SelfMediaProviderSummary[]>([]);
  const [loginPlatform, setLoginPlatform] = useState<SelfMediaPlatform | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    const bridge = getSelfMediaBridge();
    if (!activeProjectId || !bridge) return;
    setLoading(true);
    setFeedback(null);
    try {
      const providers = await bridge.listProviders();
      if (!providers.success) throw new Error(providers.error.message);
      setProviders(providers.value);
      const enabled = providers.value.filter((provider) => provider.enabled);
      const lists = await Promise.all(enabled.map((provider) => bridge.listAccounts({ projectId: activeProjectId, providerId: provider.id })));
      const failures = lists.filter((reply) => reply && !reply.success).map((reply) => reply && !reply.success ? reply.error.message : "");
      const values = lists.flatMap((reply) => reply && reply.success ? reply.value : []);
      setAccounts(values);
      if (failures.length > 0) setFeedback(failures.join("；"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "账号列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, setAccounts]);

  async function login(platform: SelfMediaPlatform) {
    const bridge = getSelfMediaBridge();
    if (!bridge || !activeProjectId) return;
    setLoginPlatform(platform);
    setFeedback(null);
    try {
      const reply = await bridge.startLogin({ projectId: activeProjectId, providerId: "aitoearn-local", platform });
      if (!reply.success) throw new Error(reply.error.message);
      setFeedback("登录窗口已完成授权，正在刷新账号状态。");
      await refreshAccounts();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "平台登录失败");
    } finally {
      setLoginPlatform(null);
    }
  }

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Users2 className="h-5 w-5 text-primary" />
            平台账号
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">管理各平台已连接账号，凭据由 Electron 主进程保管</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-sm">
            {accounts.length} 个账号
          </Badge>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={refreshAccounts} 
            disabled={loading || !activeProjectId || !getSelfMediaBridge()}
            className="gap-1.5 transition-all duration-200 hover:scale-105"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            刷新
          </Button>
        </div>
      </div>
      <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
        {selfMediaPlatformCapabilities.map((capability) => {
          const platformAccounts = accounts.filter((account) => account.platform === capability.platform);
          const provider = providers.find((item) => item.id === capability.providerId);
          const platformAvailable = provider?.availablePlatforms?.includes(capability.platform) === true;
          const unavailable = provider?.enabled === false || !platformAvailable;
          const emptyLabel = unavailable ? "当前平台暂不可用" : "尚未连接账号";
          return (
            <Card key={capability.platform} className="mb-4 break-inside-avoid border-border/50 bg-card/80 transition-all duration-200 hover:border-border/70">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span 
                      aria-hidden="true" 
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base font-semibold text-primary"
                    >
                      {capability.displayName.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <CardTitle role="heading" aria-level={3} className="truncate text-base font-semibold text-foreground">
                        {capability.displayName}
                      </CardTitle>
                      <CardDescription className="mt-1 text-sm">
                        {platformAccounts.length} 个账号
                      </CardDescription>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => login(capability.platform)} 
                    disabled={loading || loginPlatform !== null || unavailable || !getSelfMediaBridge()}
                    className="transition-all duration-200 hover:scale-105"
                  >
                    {loginPlatform === capability.platform ? <Loader2 className="h-4 w-4 animate-spin" /> : "登录"}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {capability.supportsVideo && <Badge variant="secondary" className="text-xs">视频</Badge>}
                  {capability.supportsImageText && <Badge variant="secondary" className="text-xs">图文</Badge>}
                  {capability.supportsScheduling && <Badge variant="outline" className="text-xs">定时</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {platformAccounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 bg-background/80 px-3 py-5 text-center text-xs text-muted-foreground">
                    {emptyLabel}
                  </div>
                ) : (
                  platformAccounts.map((account) => (
                    <div 
                      key={account.id} 
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5 transition-colors hover:bg-background/90"
                    >
                      <span className="truncate text-sm font-medium text-foreground">{account.displayName}</span>
                      <Badge variant={statusVariant(account.status)}>{statusLabel(account.status)}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {feedback && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span className="text-foreground">{feedback}</span>
        </div>
      )}
    </div>
  );
}

function TasksView() {
  const activeProjectId = useSelfMediaStore((state) => state.activeProjectId);
  const allTasks = useSelfMediaStore((state) => state.tasks);
  const drafts = useSelfMediaStore((state) => state.drafts ?? []);
  const upsertTask = useSelfMediaStore((state) => state.upsertTask);
  const addHistoryRecord = useSelfMediaStore((state) => state.addHistoryRecord);
  const [actioningTaskId, setActioningTaskId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const tasks = useMemo(
    () => (activeProjectId ? allTasks.filter((task) => task.projectId === activeProjectId) : []),
    [activeProjectId, allTasks],
  );
  // L6: 进度事件订阅收拢到 useSelfMediaLedger(面板级),这里不再各挂一份。

  async function cancelTask(task: SelfMediaTask) {
    const bridge = getSelfMediaBridge();
    if (!activeProjectId || task.projectId !== activeProjectId || !bridge) return;
    setActioningTaskId(task.id);
    setFeedback(null);
    try {
      const reply = await bridge.cancelTask({ projectId: task.projectId, taskId: task.id });
      if (!reply.success) throw new Error(reply.error.message);
      if (reply.value.projectId !== activeProjectId) throw new Error("取消结果不属于当前项目。");
      upsertTask(reply.value);
      if (["success", "failure", "partial", "audit", "canceled", "expired-login"].includes(reply.value.status)) {
        addHistoryRecord({ ...reply.value, finishedAt: reply.value.updatedAt });
      }
      setFeedback(`任务 ${task.id} 已取消。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "取消任务失败");
    } finally {
      setActioningTaskId(null);
    }
  }

  async function retryTask(task: SelfMediaTask) {
    if (!["failure", "expired-login"].includes(task.status) || task.projectId !== activeProjectId) return;
    const bridge = getSelfMediaBridge();
    if (!bridge?.createTask) {
      setFeedback("当前运行环境缺少创建重试任务所需的自媒体桥接，未创建重试任务。");
      return;
    }
    const draft = task.draftId ? drafts.find((item) => item.id === task.draftId) : undefined;
    if (!draft) {
      setFeedback("重试草稿不存在，未创建重试任务。");
      return;
    }
    setActioningTaskId(task.id);
    setFeedback(null);
    try {
      const reply = await bridge.createTask({ projectId: task.projectId, providerId: task.providerId, draft, previousTaskId: task.id });
      if (!reply.success) throw new Error(reply.error.message);
      reply.value.forEach(upsertTask);
      setFeedback(`已创建 ${reply.value.length} 个重试任务，关联原任务 ${task.id}。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "重试任务创建失败");
    } finally {
      setActioningTaskId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Radio className="h-5 w-5 text-primary" />
          运行中的任务
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">查看当前项目的任务执行状态</p>
      </div>
      <RecordList
        title="运行中的任务"
        icon={Radio}
        empty="当前项目还没有运行任务。"
        feedback={feedback}
        items={tasks.map((task) => ({
          id: task.id,
          title: "平台发布任务",
          description: `${statusLabel(task.status)} · ${task.progress}%${task.previousTaskId ? ` · 重试自 ${task.previousTaskId}` : ""}`,
          status: task.status,
          task,
        }))}
        renderActions={(item) => (
          <div className="flex shrink-0 items-center gap-2">
            {(item.task.status === "running" || item.task.status === "scheduled") && (
              <Button 
                size="sm" 
                variant="destructive" 
                onClick={() => cancelTask(item.task)} 
                disabled={actioningTaskId === item.id || !getSelfMediaBridge()}
                className="gap-1.5 transition-all duration-200 hover:scale-105"
              >
                {actioningTaskId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                取消任务
              </Button>
            )}
            {(item.task.status === "failure" || item.task.status === "expired-login") && !item.task.batchId && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => retryTask(item.task)}
                className="gap-1.5 transition-all duration-200 hover:scale-105"
              >
                <RotateCcw className="h-4 w-4" />
                重试任务
              </Button>
            )}
          </div>
        )}
      />
    </div>
  );
}

function HistoryView() {
  const activeProjectId = useSelfMediaStore((state) => state.activeProjectId);
  const allHistory = useSelfMediaStore((state) => state.history);
  const products = useProductStore((state) => state.products);
  const [filterProductId, setFilterProductId] = useState<string>("");

  const history = useMemo(
    () => {
      let filtered = activeProjectId ? allHistory.filter((record) => record.projectId === activeProjectId) : [];
      if (filterProductId) {
        filtered = filtered.filter((record) => record.productId === filterProductId);
      }
      return filtered;
    },
    [activeProjectId, allHistory, filterProductId],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <History className="h-5 w-5 text-primary" />
          发布历史
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">查看当前项目的发布历史记录</p>
      </div>
      {products.length > 0 && (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">按产品筛选</span>
          <select
            aria-label="按产品筛选历史"
            value={filterProductId}
            onChange={(event) => setFilterProductId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">全部产品</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <RecordList
        title="发布历史"
        icon={History}
        empty="发布完成后，结果与错误证据会保存在当前项目。"
        items={history.map((record) => ({
          id: record.id,
          title: record.resultUrl ?? record.id,
          description: `${statusLabel(record.status)} · ${record.updatedAt}${record.error ? ` · ${record.error.code}: ${record.error.message}` : ""}`,
          status: record.status,
        }))}
      />
    </div>
  );
}

/** B3: 跨项目全局历史视图——聚合所有项目的 task history */
function GlobalHistoryView() {
  const products = useProductStore((state) => state.products);
  const loadAllHistory = useSelfMediaGlobalStore((state) => state.loadAllHistory);
  const loadMore = useSelfMediaGlobalStore((state) => state.loadMore);
  const loading = useSelfMediaGlobalStore((state) => state.loading);
  const loaded = useSelfMediaGlobalStore((state) => state.loaded);
  const error = useSelfMediaGlobalStore((state) => state.error);
  const filterProductId = useSelfMediaGlobalStore((state) => state.filterProductId);
  const setFilterProductId = useSelfMediaGlobalStore((state) => state.setFilterProductId);
  const allHistory = useSelfMediaGlobalStore((state) => state.allHistory);
  const currentPage = useSelfMediaGlobalStore((state) => state.currentPage);
  const pageSize = useSelfMediaGlobalStore((state) => state.pageSize);

  // 从稳定状态派生计算值，避免 selector 中调用方法导致无限重渲染
  const filteredHistory = useMemo(
    () => (filterProductId ? allHistory.filter((r) => r.productId === filterProductId) : allHistory),
    [allHistory, filterProductId],
  );
  const pagedHistory = useMemo(
    () => filteredHistory.slice(0, currentPage * pageSize),
    [filteredHistory, currentPage, pageSize],
  );
  const total = filteredHistory.length;
  const canLoadMore = currentPage * pageSize < total;

  useEffect(() => {
    loadAllHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时加载一次

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Layers className="h-5 w-5 text-primary" />
            全部产品历史
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            跨项目聚合发布历史，共 {total} 条记录
          </p>
        </div>
        <Button 
          size="sm" 
          variant="outline" 
          onClick={() => loadAllHistory(true)} 
          disabled={loading}
          className="gap-1.5 transition-all duration-200 hover:scale-105"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          刷新
        </Button>
      </div>

      {products.length > 0 && (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">按产品筛选</span>
          <select
            aria-label="按产品筛选全局历史"
            value={filterProductId}
            onChange={(event) => setFilterProductId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">全部产品</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {loading && !loaded ? (
        <div className="flex items-center justify-center rounded-lg border border-border/40 bg-background/80 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-base text-muted-foreground">正在加载跨项目历史...</span>
        </div>
      ) : pagedHistory.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-background/80 px-6 py-16 text-center">
          <History className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-4 text-base font-medium text-muted-foreground">
            {filterProductId ? "该产品暂无发布历史" : "暂无跨项目发布历史"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground/80">
            {filterProductId ? "请切换筛选条件或查看其他产品" : "发布内容后将在此显示历史记录"}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {pagedHistory.map((record) => (
              <div
                key={`${record.projectId}-${record.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/80 px-4 py-3.5 transition-all duration-200 hover:border-border/70 hover:bg-background/90"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <p className="truncate text-sm font-semibold text-foreground">{record.resultUrl ?? record.id}</p>
                    <Badge variant="outline" className="shrink-0 text-xs font-medium">
                      {record.projectName}
                    </Badge>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    {statusLabel(record.status)} · {record.finishedAt ?? record.updatedAt}
                    {record.error ? ` · ${record.error.code}: ${record.error.message}` : ""}
                  </p>
                </div>
                <Badge variant={statusVariant(record.status)} className="text-xs font-medium">
                  {statusLabel(record.status)}
                </Badge>
              </div>
            ))}
          </div>

          {canLoadMore && (
            <div className="flex justify-center pt-6">
              <Button 
                variant="outline" 
                onClick={loadMore} 
                disabled={loading}
                className="gap-1.5 transition-all duration-200 hover:scale-105"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                加载更多
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            显示 {pagedHistory.length} / {total} 条记录
          </p>
        </>
      )}
    </div>
  );
}

function RecordList({ title, empty, icon: Icon, items, feedback, renderActions }: { title: string; empty: string; icon: typeof Radio; items: Array<{ id: string; title: string; description: string; status: string; task?: SelfMediaTask }>; feedback?: string | null; renderActions?: (item: { id: string; title: string; description: string; status: string; task: SelfMediaTask }) => ReactNode }) {
  return (
    <Card className="border-border/50 bg-card/80">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" />{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <div className="rounded-lg border border-dashed border-border/60 px-5 py-10 text-center text-sm text-muted-foreground">{empty}</div> : <div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/80 px-3 py-3 transition-colors hover:bg-background/90"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p></div><div className="flex items-center gap-2"><Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>{item.task && renderActions?.(item as typeof item & { task: SelfMediaTask })}</div></div>)}</div>}
        {feedback && <p className="mt-3 text-xs text-muted-foreground">{feedback}</p>}
      </CardContent>
    </Card>
  );
}

export function SelfMediaPanel() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selfMediaProjectId = useSelfMediaStore((state) => state.activeProjectId);
  const [section, setSection] = useState<SelfMediaSection>("accounts");
  // L6: 任务台账订阅收拢——进面板拉列表、进度事件更新(不盖写 updatedAt)、
  // 终态防抖重取。返回日志损坏告警文案。
  const journalWarning = useSelfMediaLedger(
    activeProjectId && selfMediaProjectId === activeProjectId ? activeProjectId : null,
  );

  const sectionContent = {
    accounts: <AccountsView />,
    compose: <ComposeView />,
    batch: <BatchPublishView />,
    tasks: <TasksView />,
    history: <HistoryView />,
    products: <ProductsView />,
    templates: <TemplateView />,
    showcase: <ShowcaseView />,
    global: <GlobalHistoryView />,
  }[section];

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.08),transparent_50%),radial-gradient(ellipse_at_bottom_left,hsl(var(--accent)/0.05),transparent_50%),hsl(var(--background))]">
      <div className="flex h-full min-h-0 flex-col">
        <header className="relative border-b border-border/40 bg-background/80 px-6 py-5 backdrop-blur-md">
          <div className="mx-auto w-full max-w-7xl">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">自媒体发布台</h1>
            {journalWarning && <p role="alert" className="mt-1.5 text-xs text-destructive">{journalWarning}</p>}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border/40 bg-background/80 p-3 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-4">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-200 ${
                  section === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/90 hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${section === id ? "text-primary-foreground" : "text-muted-foreground/70"}`} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <ScrollArea className="min-h-0 flex-1">
            <main className="mx-auto w-full max-w-7xl p-5 md:p-8">{sectionContent}</main>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
