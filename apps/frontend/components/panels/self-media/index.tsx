import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileVideo2,
  History,
  LayoutGrid,
  Loader2,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Users2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/stores/project/project-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useSelfMediaStore } from "@/stores/self-media/self-media-store";
import { getSelfMediaCapabilities } from "@/lib/self-media/capabilities";
import { validateSelfMediaDraft } from "@/lib/self-media/contracts";
import type { SelfMediaContentType, SelfMediaDraft, SelfMediaProviderSummary, SelfMediaTask } from "@/types/self-media";

type SelfMediaSection = "accounts" | "compose" | "tasks" | "history";

function getSelfMediaBridge() {
  return typeof window === "undefined" ? undefined : window.selfMedia;
}

const sections: Array<{ id: SelfMediaSection; label: string; icon: typeof Users2 }> = [
  { id: "accounts", label: "账号", icon: Users2 },
  { id: "compose", label: "发布", icon: Send },
  { id: "tasks", label: "任务", icon: Radio },
  { id: "history", label: "历史", icon: History },
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

function isTerminalTaskStatus(status: SelfMediaTask["status"]): boolean {
  return ["success", "failure", "partial", "audit", "canceled", "expired-login"].includes(status);
}

function AccountsView() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const accounts = useSelfMediaStore((state) => state.accounts);
  const setAccounts = useSelfMediaStore((state) => state.setAccounts);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<SelfMediaProviderSummary[]>([]);
  const [loginPlatform, setLoginPlatform] = useState<"xhs" | "douyin" | "wxSph" | "KWAI" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refreshAccounts() {
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
  }

  async function login(platform: "xhs" | "douyin" | "wxSph" | "KWAI") {
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
  }, [activeProjectId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <Card className="border-border/70 bg-card/70 shadow-2xl shadow-black/10">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Users2 className="h-4 w-4 text-primary" />已连接账号</CardTitle>
              <CardDescription className="mt-1">凭据只由 Electron 主进程管理，渲染层只接收脱敏摘要。</CardDescription>
            </div>
            <div className="flex items-center gap-2"><Badge variant="outline">{accounts.length} 个账号</Badge><Button size="sm" variant="outline" onClick={refreshAccounts} disabled={loading || !activeProjectId || !getSelfMediaBridge()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "刷新"}</Button></div>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-background/40 px-5 py-10 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">还没有连接账号</p>
              <p className="mt-1 text-xs text-muted-foreground">选择平台后会打开原生 Electron 登录窗口，凭据不会进入渲染层。</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {(["xhs", "douyin", "wxSph", "KWAI"] as const).map((platform) => (
                  <Button key={platform} size="sm" variant="outline" onClick={() => login(platform)} disabled={loading || loginPlatform !== null || !getSelfMediaBridge()}>
                    {loginPlatform === platform ? <Loader2 className="h-4 w-4 animate-spin" /> : getSelfMediaCapabilities("aitoearn-local", platform)?.displayName}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {accounts.map((account) => (
                <div key={account.id} className="rounded-xl border border-border/70 bg-background/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{account.displayName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{account.capabilities.displayName}</p>
                    </div>
                    <Badge variant={statusVariant(account.status)}>{statusLabel(account.status)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <span className="text-xs text-muted-foreground">连接新账号</span>
            {(["xhs", "douyin", "wxSph", "KWAI"] as const).map((platform) => (
              <Button key={platform} size="sm" variant="outline" onClick={() => login(platform)} disabled={loading || loginPlatform !== null || !getSelfMediaBridge()}>
                {loginPlatform === platform ? <Loader2 className="h-4 w-4 animate-spin" /> : getSelfMediaCapabilities("aitoearn-local", platform)?.displayName}
              </Button>
            ))}
          </div>
          {feedback && <p className="mt-3 text-xs text-muted-foreground">{feedback}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ComposeView() {
  const { activeProjectId } = useProjectStore();
  const mediaFiles = useMediaStore((state) => state.mediaFiles);
  const accounts = useSelfMediaStore((state) => state.accounts);
  const saveDraft = useSelfMediaStore((state) => state.saveDraft);
  const upsertTask = useSelfMediaStore((state) => state.upsertTask);
  const addHistoryRecord = useSelfMediaStore((state) => state.addHistoryRecord);
  const [contentType, setContentType] = useState<SelfMediaContentType>("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [coverAssetId, setCoverAssetId] = useState("");
  const [platform, setPlatform] = useState<"xhs" | "douyin" | "wxSph" | "KWAI">("xhs");
  const [publishMode, setPublishMode] = useState<"immediate" | "scheduled">("immediate");
  const [visibility, setVisibility] = useState<"public" | "private" | "friends">("public");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [platformOptions, setPlatformOptions] = useState<Record<string, string | boolean>>({});
  const [scheduledAt, setScheduledAt] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const capability = useMemo(() => getSelfMediaCapabilities("aitoearn-local", platform), [platform]);
  const projectMedia = useMemo(
    () => mediaFiles.filter((media) => media.projectId === activeProjectId && (media.type === "video" || media.type === "image") && !media.ephemeral),
    [activeProjectId, mediaFiles],
  );
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => account.platform === platform && account.status === "online" && account.providerId === "aitoearn-local" && (contentType === "video" ? account.capabilities.supportsVideo : account.capabilities.supportsImageText)),
    [accounts, platform, contentType],
  );
  const selectedAssets = useMemo(
    () => projectMedia.filter((media) => assetIds.includes(media.id) && Boolean(media.url)),
    [assetIds, projectMedia],
  );
  const selectedCover = useMemo(() => projectMedia.find((media) => media.id === coverAssetId && Boolean(media.url)), [coverAssetId, projectMedia]);
  const draft: SelfMediaDraft | null = activeProjectId
    ? {
        id: "self-media-draft-editor",
        projectId: activeProjectId,
        contentType,
        title,
        description,
        topics: topics.split(/[\s,，]+/).filter(Boolean),
        assets: selectedAssets.map((media) => ({ assetId: media.id, projectId: activeProjectId, kind: media.type as "video" | "image", approvedUrl: media.url, thumbnailUrl: media.thumbnailUrl })),
        cover: selectedCover ? { assetId: selectedCover.id, projectId: activeProjectId, kind: selectedCover.type as "video" | "image", approvedUrl: selectedCover.url, thumbnailUrl: selectedCover.thumbnailUrl } : undefined,
        accountIds: selectedAccountIds.filter((id) => selectedAccounts.some((account) => account.id === id)),
        visibility,
        platformOptions: {
          platform,
          ...Object.fromEntries(
            Object.entries(platformOptions).filter(([key]) => capability?.optionKeys.includes(key)),
          ),
        },
        scheduledAt: publishMode === "scheduled" && capability?.supportsScheduling ? scheduledAt || undefined : undefined,
        updatedAt: new Date().toISOString(),
      }
    : null;

  function save() {
    if (!draft) {
      setFeedback("请先打开一个项目。");
      return;
    }
    const result = validateSelfMediaDraft(draft);
    if (!result.success) {
      setFeedback(result.issues.map((issue) => `${issue.path || "草稿"}：${issue.message}`).join("；"));
      return;
    }
    saveDraft(result.value);
    setFeedback("草稿已保存到当前项目。");
  }

  async function publish() {
    if (!draft) {
      setFeedback("请先打开一个项目。");
      return;
    }
    const result = validateSelfMediaDraft(draft);
    if (!result.success) {
      setFeedback(result.issues.map((issue) => `${issue.path || "草稿"}：${issue.message}`).join("；"));
      return;
    }
    const bridge = getSelfMediaBridge();
    if (!bridge) {
      setFeedback("当前运行环境没有自媒体主进程桥接。");
      return;
    }
    setPublishing(true);
    setFeedback(null);
    try {
      saveDraft(result.value);
      const reply = await bridge.createTask({ projectId: result.value.projectId, providerId: "aitoearn-local", draft: result.value });
      if (!reply.success) throw new Error(reply.error.message);
      reply.value.forEach((task) => {
        upsertTask(task);
        if (isTerminalTaskStatus(task.status)) addHistoryRecord({ ...task, finishedAt: task.updatedAt });
      });
      setFeedback(`已创建 ${reply.value.length} 个任务，状态会通过主进程进度事件更新。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "发布任务创建失败");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Card className="border-border/70 bg-card/70 shadow-2xl shadow-black/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FileVideo2 className="h-4 w-4 text-primary" />内容草稿</CardTitle>
        <CardDescription>先完成 MYStudio 资产与文案校验，再交给明确选择的 provider。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {(["video", "image-text"] as const).map((type) => (
            <Button key={type} variant={contentType === type ? "primary" : "outline"} size="sm" onClick={() => setContentType(type)}>
              {type === "video" ? "视频" : "图文"}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">当前能力：{capability?.displayName ?? "未支持"}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">标题</span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：三分钟看懂这一集" maxLength={100} /></label>
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">媒体资产</span>
            <select aria-label="媒体资产" multiple={contentType === "image-text"} size={contentType === "image-text" ? 4 : 1} value={contentType === "image-text" ? assetIds : assetIds[0] ?? ""} onChange={(event) => setAssetIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="" disabled>{projectMedia.length > 0 ? "选择当前项目素材" : "素材库暂无可用图片或视频"}</option>
              {projectMedia.filter((media) => contentType === "video" ? media.type === "video" : media.type === "image").map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">描述</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="发布描述，不包含凭据或本地绝对路径" rows={4} maxLength={5000} /></label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">话题</span><Input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="#漫剧 #剧情解说" /></label>
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">封面素材</span>
            <select aria-label="封面素材" value={coverAssetId} onChange={(event) => setCoverAssetId(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">选择封面（视频发布必选）</option>
              {projectMedia.filter((media) => media.type === "image").map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">发布方式</span><select aria-label="发布方式" value={publishMode} onChange={(event) => setPublishMode(event.target.value as "immediate" | "scheduled")} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="immediate">立即发布</option><option value="scheduled" disabled={!capability?.supportsScheduling}>定时发布</option></select>{publishMode === "scheduled" && <Input aria-label="定时发布时间" type="datetime-local" value={scheduledAt ? scheduledAt.slice(0, 16) : ""} onChange={(event) => setScheduledAt(event.target.value ? new Date(event.target.value).toISOString() : "")} disabled={!capability?.supportsScheduling} />}<span className="block text-xs text-muted-foreground">{capability?.supportsScheduling ? "由 MYStudio 主进程持久化，到点后交给本地 provider" : "当前 provider 不支持定时发布，已安全禁用"}</span></label>
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">可见范围</span><select aria-label="可见范围" value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "private" | "friends")} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="public">公开</option><option value="private">仅自己</option><option value="friends">好友可见</option></select></label>
        </div>
        {capability && capability.optionKeys.length > 0 && (
          <div className="grid gap-4 rounded-lg border border-border/60 bg-background/30 p-3 md:grid-cols-2">
            {capability.optionKeys.includes("location") && <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">位置（可选）</span><Input aria-label="平台位置" value={typeof platformOptions.location === "string" ? platformOptions.location : ""} onChange={(event) => setPlatformOptions((current) => ({ ...current, location: event.target.value }))} /></label>}
            {capability.optionKeys.includes("collection") && <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">合集（可选）</span><Input aria-label="平台合集" value={typeof platformOptions.collection === "string" ? platformOptions.collection : ""} onChange={(event) => setPlatformOptions((current) => ({ ...current, collection: event.target.value }))} /></label>}
            {capability.optionKeys.includes("allowComment") && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input aria-label="允许评论" type="checkbox" checked={platformOptions.allowComment !== false} onChange={(event) => setPlatformOptions((current) => ({ ...current, allowComment: event.target.checked }))} />允许评论</label>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <span className="text-xs text-muted-foreground">目标平台</span>
          {(["xhs", "douyin", "wxSph", "KWAI"] as const).map((item) => {
            const itemCapability = getSelfMediaCapabilities("aitoearn-local", item);
            const disabled = contentType === "image-text" && !itemCapability?.supportsImageText;
            return <Button key={item} size="sm" variant={platform === item ? "secondary" : "outline"} disabled={disabled} onClick={() => { setPlatform(item); setAssetIds([]); setCoverAssetId(""); setPlatformOptions({}); }}>{itemCapability?.displayName ?? item}</Button>;
          })}
          <Button className="ml-auto gap-2" onClick={save}><CheckCircle2 className="h-4 w-4" />保存草稿</Button>
          <Button className="gap-2" onClick={publish} disabled={publishing || !getSelfMediaBridge()}>{publishing && <Loader2 className="h-4 w-4 animate-spin" />}{publishMode === "scheduled" ? "创建定时任务" : "立即发布"}</Button>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/30 p-3"><p className="mb-2 text-xs text-muted-foreground">明确选择发布账号（仅展示支持当前内容类型的在线账号）</p>{selectedAccounts.length === 0 ? <p className="text-xs text-muted-foreground">当前平台没有可用账号，请先在“账号”视图连接并刷新。</p> : <div className="grid gap-2 sm:grid-cols-2">{selectedAccounts.map((account) => <label key={account.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedAccountIds.includes(account.id)} onChange={(event) => setSelectedAccountIds((ids) => event.target.checked ? [...ids, account.id] : ids.filter((id) => id !== account.id))} />{account.displayName}</label>)}</div>}</div>
        {feedback && <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{feedback}</div>}
      </CardContent>
    </Card>
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

  useEffect(() => {
    const bridge = getSelfMediaBridge();
    if (!bridge) return;
    return bridge.onProgress((progress) => {
      const current = useSelfMediaStore.getState().tasks.find((task) => task.id === progress.taskId);
      if (!current || current.projectId !== progress.projectId) return;
      const next = { ...current, status: progress.status, progress: progress.progress, updatedAt: new Date().toISOString() };
      upsertTask(next);
      if (["success", "failure", "partial", "audit", "canceled", "expired-login"].includes(next.status)) {
        addHistoryRecord({ ...next, finishedAt: next.updatedAt });
      }
    });
  }, [addHistoryRecord, upsertTask]);

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
    <RecordList
      title="运行中的任务"
      icon={Radio}
      empty="当前项目还没有运行任务。"
      feedback={feedback}
      items={tasks.map((task) => ({
        id: task.id,
        title: `${task.providerId} · ${task.accountId}`,
        description: `${statusLabel(task.status)} · ${task.progress}%${task.previousTaskId ? ` · 重试自 ${task.previousTaskId}` : ""}`,
        status: task.status,
        task,
      }))}
      renderActions={(item) => (
        <div className="flex shrink-0 items-center gap-2">
          {(item.task.status === "running" || item.task.status === "scheduled") && (
            <Button size="sm" variant="destructive" onClick={() => cancelTask(item.task)} disabled={actioningTaskId === item.id || !getSelfMediaBridge()}>
              {actioningTaskId === item.id ? <Loader2 className="animate-spin" /> : <XCircle />}
              取消任务
            </Button>
          )}
          {(item.task.status === "failure" || item.task.status === "expired-login") && (
            <Button size="sm" variant="outline" onClick={() => retryTask(item.task)}>
              <RotateCcw />重试任务
            </Button>
          )}
        </div>
      )}
    />
  );
}

function HistoryView() {
  const activeProjectId = useSelfMediaStore((state) => state.activeProjectId);
  const allHistory = useSelfMediaStore((state) => state.history);
  const history = useMemo(
    () => (activeProjectId ? allHistory.filter((record) => record.projectId === activeProjectId) : []),
    [activeProjectId, allHistory],
  );
  return <RecordList title="发布历史" icon={History} empty="发布完成后，结果与错误证据会保存在当前项目。" items={history.map((record) => ({ id: record.id, title: record.resultUrl ?? record.id, description: `${statusLabel(record.status)} · ${record.updatedAt}${record.error ? ` · ${record.error.code}: ${record.error.message}` : ""}`, status: record.status }))} />;
}

function RecordList({ title, empty, icon: Icon, items, feedback, renderActions }: { title: string; empty: string; icon: typeof Radio; items: Array<{ id: string; title: string; description: string; status: string; task?: SelfMediaTask }>; feedback?: string | null; renderActions?: (item: { id: string; title: string; description: string; status: string; task: SelfMediaTask }) => ReactNode }) {
  return (
    <Card className="border-border/70 bg-card/70 shadow-2xl shadow-black/10">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" />{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <div className="rounded-xl border border-dashed border-border/80 px-5 py-10 text-center text-sm text-muted-foreground">{empty}</div> : <div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p></div><div className="flex items-center gap-2"><Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>{item.task && renderActions?.(item as typeof item & { task: SelfMediaTask })}</div></div>)}</div>}
        {feedback && <p className="mt-3 text-xs text-muted-foreground">{feedback}</p>}
      </CardContent>
    </Card>
  );
}

export function SelfMediaPanel() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selfMediaProjectId = useSelfMediaStore((state) => state.activeProjectId);
  const replaceProjectTasks = useSelfMediaStore((state) => state.replaceProjectTasks);
  const [section, setSection] = useState<SelfMediaSection>("accounts");

  useEffect(() => {
    const bridge = getSelfMediaBridge();
    if (!bridge || !activeProjectId || selfMediaProjectId !== activeProjectId) return;
    let disposed = false;
    void bridge.listTasks({ projectId: activeProjectId }).then((reply) => {
      if (
        disposed
        || !reply.success
        || useProjectStore.getState().activeProjectId !== activeProjectId
        || useSelfMediaStore.getState().activeProjectId !== activeProjectId
      ) return;
      replaceProjectTasks(activeProjectId, reply.value);
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [activeProjectId, replaceProjectTasks, selfMediaProjectId]);

  const sectionContent = {
    accounts: <AccountsView />,
    compose: <ComposeView />,
    tasks: <TasksView />,
    history: <HistoryView />,
  }[section];

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.18))]">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-border/60 bg-background/50 px-6 py-5 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-7xl items-end justify-between gap-4">
            <div><div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary"><LayoutGrid className="h-3.5 w-3.5" />Self-media workspace</div><h1 className="mt-2 text-2xl font-semibold tracking-tight">自媒体发布台</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">把 MYStudio 产物交给明确的发布 provider，账号、任务、历史与项目一起可追溯。</p></div>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><Clock3 className="h-4 w-4" />本地优先 · 不嵌入 Web</div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-border/50 bg-background/25 p-3 md:w-48 md:flex-col md:border-b-0 md:border-r md:p-4">
            {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setSection(id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${section === id ? "bg-primary text-primary-foreground shadow-lg shadow-primary/15" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}><Icon className="h-4 w-4" />{label}</button>)}
          </nav>
          <ScrollArea className="min-h-0 flex-1"><main className="mx-auto w-full max-w-7xl p-5 md:p-7">{sectionContent}</main></ScrollArea>
        </div>
      </div>
    </div>
  );
}
