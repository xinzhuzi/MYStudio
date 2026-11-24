import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Copy,
  Download,
  Globe2,
  History,
  Layers,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Trash2,
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
import { useProductStore } from "@/stores/product/product-store";
import { useSelfMediaGlobalStore } from "@/stores/self-media/self-media-global-store";
import {
  getSelfMediaCapabilities,
  isSelfMediaPublishable,
  SELF_MEDIA_CAPABILITY_MANIFEST,
} from "@/lib/self-media/capabilities";
import { validateSelfMediaDraft } from "@/lib/self-media/contracts";
import type { SelfMediaContentType, SelfMediaDraft, SelfMediaPlatform, SelfMediaProviderSummary, SelfMediaTask } from "@/types/self-media";
import type { Product, ProductLink, ProductCtaType } from "@/types/product";
import { BatchPublishView } from "./batch-publish-view";
import { TemplateView } from "./template-view";
import { ShowcaseView } from "./showcase-view";
import { buildUtmUrl, copyUtmToClipboard } from "@/lib/self-media/utm";

type SelfMediaSection = "accounts" | "compose" | "batch" | "tasks" | "history" | "products" | "global" | "templates" | "showcase";

function getSelfMediaBridge() {
  return typeof window === "undefined" ? undefined : window.selfMedia;
}

function getProductBridge() {
  return typeof window === "undefined" ? undefined : window.productBridge;
}

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

const selfMediaPlatformCapabilities = Object.values(SELF_MEDIA_CAPABILITY_MANIFEST);

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
            <Card key={capability.platform} className="mb-4 break-inside-avoid border-border/50 bg-card/60 transition-all duration-200 hover:border-border/70">
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
                  <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-3 py-5 text-center text-xs text-muted-foreground">
                    {emptyLabel}
                  </div>
                ) : (
                  platformAccounts.map((account) => (
                    <div 
                      key={account.id} 
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2.5 transition-colors hover:bg-background/70"
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
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span className="text-foreground">{feedback}</span>
        </div>
      )}
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
  const products = useProductStore((state) => state.products);
  const [contentType, setContentType] = useState<SelfMediaContentType>("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [coverAssetId, setCoverAssetId] = useState("");
  const [platform, setPlatform] = useState<SelfMediaPlatform>("xhs");
  const [publishMode, setPublishMode] = useState<"immediate" | "scheduled">("immediate");
  const [visibility, setVisibility] = useState<"public" | "private" | "friends">("public");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [platformOptions, setPlatformOptions] = useState<Record<string, string | boolean>>({});
  const [scheduledAt, setScheduledAt] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [utmBaseUrl, setUtmBaseUrl] = useState("");
  const [utmCopied, setUtmCopied] = useState(false);
  const utmCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 首次进入 ComposeView 时预加载产品列表(不依赖用户先访问「产品」tab)
  useEffect(() => {
    if (products.length > 0) return;
    const bridge = getProductBridge();
    if (!bridge) return;
    bridge.list().then((reply) => {
      if (reply.success) useProductStore.getState().setProducts(reply.value);
    }).catch(() => { /* 静默降级,产品下拉为空即可 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时加载一次

  const capability = useMemo(() => getSelfMediaCapabilities("aitoearn-local", platform), [platform]);
  const supportsCurrentContentType = isSelfMediaPublishable("aitoearn-local", platform, contentType);
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

  // ─── B4 UTM 推广链接 ────────────────────────────────────────────────────────
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );
  const utmUrl = useMemo(() => {
    if (!utmBaseUrl.trim() || !selectedProduct) return "";
    return buildUtmUrl(utmBaseUrl.trim(), {
      source: capability?.displayName ?? platform,
      medium: "social",
      campaign: selectedProduct.promotion.utm.campaign || selectedProduct.slug,
      content: title || undefined,
    });
  }, [utmBaseUrl, selectedProduct, capability, platform, title]);

  async function handleCopyUtm() {
    if (!utmUrl) return;
    const ok = await copyUtmToClipboard(utmUrl);
    if (!ok) return;
    setUtmCopied(true);
    if (utmCopyTimerRef.current) clearTimeout(utmCopyTimerRef.current);
    utmCopyTimerRef.current = setTimeout(() => setUtmCopied(false), 2000);
  }

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    const product = products.find((p) => p.id === productId);
    if (product) {
      setDescription(product.description);
      setTopics(product.promotion.defaultTags.map((tag) => `#${tag}`).join(" "));
    }
  };
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
    <Card className="border-border/50 bg-card/60">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Send className="h-5 w-5 text-primary" />
          发布
        </CardTitle>
        <CardDescription className="mt-1 text-sm text-muted-foreground">
          创建并发布内容到指定平台
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {(["video", "image-text"] as const).map((type) => (
            <Button
              key={type}
              variant={contentType === type ? "primary" : "outline"}
              size="sm"
              onClick={() => setContentType(type)}
              disabled={type === "video" ? !capability?.supportsVideo : !capability?.supportsImageText}
              className="transition-all duration-200 hover:scale-105"
            >
              {type === "video" ? "视频" : "图文"}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">当前平台：{capability?.displayName ?? "未支持"}</span>
        </div>
        {products.length > 0 && (
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">关联产品</span>
            <select
              aria-label="关联产品"
              value={selectedProductId}
              onChange={(event) => handleProductSelect(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">不关联产品</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* B4 推广链接生成器 */}
        {selectedProduct && (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">推广链接</span>
              <span className="text-xs text-muted-foreground">
                source={capability?.displayName ?? platform} · campaign={selectedProduct.promotion.utm.campaign || selectedProduct.slug}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                aria-label="落地页地址"
                value={utmBaseUrl}
                onChange={(e) => setUtmBaseUrl(e.target.value)}
                placeholder="https://example.com/product"
                className="flex-1 text-sm transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyUtm}
                disabled={!utmUrl}
                className="gap-1.5 transition-all duration-200 hover:scale-105"
              >
                {utmCopied ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                {utmCopied ? "已复制" : "复制"}
              </Button>
            </div>
            {utmUrl && (
              <div className="rounded-md bg-background/60 p-2.5">
                <p className="break-all text-xs text-muted-foreground" title={utmUrl}>
                  {utmUrl}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">标题</span>
            <Input 
              value={title} 
              onChange={(event) => setTitle(event.target.value)} 
              placeholder="例如：三分钟看懂这一集" 
              maxLength={100}
              className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">媒体资产</span>
            <select 
              aria-label="媒体资产" 
              multiple={contentType === "image-text"} 
              size={contentType === "image-text" ? 4 : 1} 
              value={contentType === "image-text" ? assetIds : assetIds[0] ?? ""} 
              onChange={(event) => setAssetIds(Array.from(event.target.selectedOptions, (option) => option.value))} 
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="" disabled>{projectMedia.length > 0 ? "选择当前项目素材" : "素材库暂无可用图片或视频"}</option>
              {projectMedia.filter((media) => contentType === "video" ? media.type === "video" : media.type === "image").map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">描述</span>
          <Textarea 
            value={description} 
            onChange={(event) => setDescription(event.target.value)} 
            placeholder="发布描述，不包含凭据或本地绝对路径" 
            rows={4} 
            maxLength={5000}
            className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">话题</span>
            <Input 
              value={topics} 
              onChange={(event) => setTopics(event.target.value)} 
              placeholder="#漫剧 #剧情解说"
              className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">封面素材</span>
            <select 
              aria-label="封面素材" 
              value={coverAssetId} 
              onChange={(event) => setCoverAssetId(event.target.value)} 
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">选择封面（视频发布必选）</option>
              {projectMedia.filter((media) => media.type === "image").map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">发布方式</span>
            <select 
              aria-label="发布方式" 
              value={publishMode} 
              onChange={(event) => setPublishMode(event.target.value as "immediate" | "scheduled")} 
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="immediate">立即发布</option>
              <option value="scheduled" disabled={!capability?.supportsScheduling}>定时发布</option>
            </select>
            {publishMode === "scheduled" && (
              <Input 
                aria-label="定时发布时间" 
                type="datetime-local" 
                value={scheduledAt ? scheduledAt.slice(0, 16) : ""} 
                onChange={(event) => setScheduledAt(event.target.value ? new Date(event.target.value).toISOString() : "")} 
                disabled={!capability?.supportsScheduling}
                className="mt-2 transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            )}
            <span className="block text-xs text-muted-foreground">
              {capability?.supportsScheduling ? "由 MYStudio 保存，到点后提交" : "当前平台不支持定时发布，已安全禁用"}
            </span>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">可见范围</span>
            <select 
              aria-label="可见范围" 
              value={visibility} 
              onChange={(event) => setVisibility(event.target.value as "public" | "private" | "friends")} 
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="public">公开</option>
              <option value="private">仅自己</option>
              <option value="friends">好友可见</option>
            </select>
          </label>
        </div>
        {capability && capability.optionKeys.length > 0 && (
          <div className="grid gap-4 rounded-lg border border-border/40 bg-background/40 p-4 md:grid-cols-2">
            {capability.optionKeys.includes("location") && (
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-foreground">位置（可选）</span>
                <Input 
                  aria-label="平台位置" 
                  value={typeof platformOptions.location === "string" ? platformOptions.location : ""} 
                  onChange={(event) => setPlatformOptions((current) => ({ ...current, location: event.target.value }))}
                  className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}
            {capability.optionKeys.includes("collection") && (
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-foreground">合集（可选）</span>
                <Input 
                  aria-label="平台合集" 
                  value={typeof platformOptions.collection === "string" ? platformOptions.collection : ""} 
                  onChange={(event) => setPlatformOptions((current) => ({ ...current, collection: event.target.value }))}
                  className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}
            {capability.optionKeys.includes("allowComment") && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input 
                  aria-label="允许评论" 
                  type="checkbox" 
                  checked={platformOptions.allowComment !== false} 
                  onChange={(event) => setPlatformOptions((current) => ({ ...current, allowComment: event.target.checked }))}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
                />
                <span className="font-medium text-foreground">允许评论</span>
              </label>
            )}
            {capability.optionKeys.includes("tid") && (
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-foreground">B站分区 ID</span>
                <Input 
                  aria-label="B站分区 ID" 
                  inputMode="numeric" 
                  value={typeof platformOptions.tid === "string" ? platformOptions.tid : ""} 
                  onChange={(event) => setPlatformOptions((current) => ({ ...current, tid: event.target.value }))} 
                  placeholder="例如：171"
                  className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}
            {capability.optionKeys.includes("boardId") && (
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-foreground">Pinterest 画板 ID</span>
                <Input 
                  aria-label="Pinterest 画板 ID" 
                  value={typeof platformOptions.boardId === "string" ? platformOptions.boardId : ""} 
                  onChange={(event) => setPlatformOptions((current) => ({ ...current, boardId: event.target.value }))}
                  className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-4">
          <span className="text-sm font-medium text-foreground">目标平台</span>
          <div className="flex flex-wrap gap-1.5">
            {selfMediaPlatformCapabilities.map((itemCapability) => {
              const item = itemCapability.platform;
              const available = accounts.some((account) => account.platform === item);
              return (
                <Button 
                  key={item} 
                  size="sm" 
                  variant={platform === item ? "secondary" : "outline"} 
                  disabled={!available}
                  className="transition-all duration-200 hover:scale-105"
                  onClick={() => {
                    setPlatform(item);
                    if (itemCapability.supportsVideo) setContentType("video");
                    else if (itemCapability.supportsImageText) setContentType("image-text");
                    setAssetIds([]);
                    setCoverAssetId("");
                    setSelectedAccountIds([]);
                    setPlatformOptions({});
                  }}
                >
                  {itemCapability.displayName}
                </Button>
              );
            })}
          </div>
          <div className="ml-auto flex gap-2">
            <Button 
              variant="outline"
              className="gap-2 transition-all duration-200 hover:scale-105" 
              onClick={save} 
              disabled={!supportsCurrentContentType}
            >
              <CheckCircle2 className="h-4 w-4" />
              保存草稿
            </Button>
            <Button 
              className="gap-2 transition-all duration-200 hover:scale-105"
              onClick={publish}
              disabled={publishing || !supportsCurrentContentType || !getSelfMediaBridge()}
            >
              {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
              {publishMode === "scheduled" ? "创建定时任务" : "立即发布"}
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/40 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">明确选择发布账号</p>
          <p className="mb-3 text-xs text-muted-foreground">仅展示支持当前内容类型的在线账号</p>
          {selectedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前平台没有可用账号，请先在"账号"视图连接并刷新。</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedAccounts.map((account) => (
                <label 
                  key={account.id} 
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border/50 bg-background/60 px-3 py-2.5 text-sm transition-all duration-200 hover:border-primary/50 hover:bg-background/80"
                >
                  <input 
                    type="checkbox" 
                    checked={selectedAccountIds.includes(account.id)} 
                    onChange={(event) => setSelectedAccountIds((ids) => event.target.checked ? [...ids, account.id] : ids.filter((id) => id !== account.id))}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="font-medium text-foreground">{account.displayName}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {feedback && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="text-foreground">{feedback}</span>
          </div>
        )}
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
            {(item.task.status === "failure" || item.task.status === "expired-login") && (
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
        <div className="flex items-center justify-center rounded-lg border border-border/40 bg-background/30 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-base text-muted-foreground">正在加载跨项目历史...</span>
        </div>
      ) : pagedHistory.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-background/30 px-6 py-16 text-center">
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
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/50 px-4 py-3.5 transition-all duration-200 hover:border-border/70 hover:bg-background/70"
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

function createEmptyProduct(): Product {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: "",
    slug: "",
    description: "",
    detail: "",
    coverImage: "",
    links: [],
    tags: [],
    projectIds: [],
    brandProfile: { primaryColor: "", tone: [], forbiddenWords: [] },
    promotion: { defaultTags: [], utm: { campaign: "" }, ctaType: "learn_more" },
    createdAt: now,
    updatedAt: now,
  };
}

function ProductsView() {
  const products = useProductStore((state) => state.products);
  const setProducts = useProductStore((state) => state.setProducts);
  const upsertProductLocal = useProductStore((state) => state.upsertProduct);
  const removeProductLocal = useProductStore((state) => state.removeProduct);
  const setLoading = useProductStore((state) => state.setLoading);
  const loading = useProductStore((state) => state.loading);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSave(product: Product) {
    const bridge = getProductBridge();
    if (!bridge) return;
    setFeedback(null);
    try {
      const reply = await bridge.upsert({ product });
      if (!reply.success) throw new Error(reply.error.message);
      upsertProductLocal(reply.value);
      setEditingProduct(null);
      setFeedback("产品已保存");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "产品保存失败");
    }
  }

  async function handleDelete(id: string) {
    const bridge = getProductBridge();
    if (!bridge) return;
    setFeedback(null);
    try {
      const reply = await bridge.delete({ id });
      if (!reply.success) throw new Error(reply.error.message);
      removeProductLocal(id);
      if (editingProduct?.id === id) setEditingProduct(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "产品删除失败");
    }
  }

  async function handleExport() {
    const bridge = getProductBridge();
    if (!bridge) return;
    setFeedback(null);
    try {
      const reply = await bridge.exportWithDialog();
      if (!reply.success) throw new Error(reply.error.message);
      if ("cancelled" in reply.value) {
        setFeedback("导出已取消");
      } else {
        setFeedback(`产品数据已导出到 ${reply.value.savedPath}`);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "产品导出失败");
    }
  }

  const refreshProducts = useCallback(async () => {
    const bridge = getProductBridge();
    if (!bridge) return;
    setLoading(true);
    setFeedback(null);
    try {
      const reply = await bridge.list();
      if (!reply.success) throw new Error(reply.error.message);
      setProducts(reply.value);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "产品列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [setProducts, setLoading, setFeedback]);

  useEffect(() => {
    refreshProducts();
  }, [refreshProducts]);

  if (editingProduct) {
    return (
      <ProductEditForm
        product={editingProduct}
        onSave={handleSave}
        onCancel={() => setEditingProduct(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Box className="h-5 w-5 text-primary" />
            产品目录
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">管理您的产品，关联推广内容</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refreshProducts} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            刷新
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={products.length === 0}>
            <Download className="h-4 w-4" />
            导出
          </Button>
          <Button size="sm" onClick={() => setEditingProduct(createEmptyProduct())}>
            <Plus className="h-4 w-4" />
            新增
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-background/30 px-6 py-12 text-center">
            <Box className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">暂无产品</p>
            <p className="mt-1 text-xs text-muted-foreground/80">点击「新增」按钮创建第一个产品</p>
          </div>
        ) : (
          products.map((product) => (
            <Card key={product.id} className="group border-border/50 bg-card/60 transition-all duration-200 hover:border-border/70 hover:bg-card/80">
              <CardContent className="flex items-start justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate text-base font-semibold text-foreground">{product.name || "未命名产品"}</span>
                    <Badge variant="outline" className="text-xs">{product.slug}</Badge>
                  </div>
                  {product.description && (
                    <p className="mt-1.5 truncate text-sm text-muted-foreground">{product.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {product.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                    {product.tags.length > 3 && (
                      <Badge variant="secondary" className="text-xs">+{product.tags.length - 3}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <Button size="sm" variant="ghost" onClick={() => setEditingProduct(product)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(product.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {feedback}
        </div>
      )}
    </div>
  );
}

function ProductEditForm({ product, onSave, onCancel }: { product: Product; onSave: (product: Product) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Product>(product);
  const [newLink, setNewLink] = useState<ProductLink>({ label: "", url: "", platform: "web" });

  function updateField<K extends keyof Product>(key: K, value: Product[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addLink() {
    if (!newLink.label || !newLink.url) return;
    updateField("links", [...form.links, newLink]);
    setNewLink({ label: "", url: "", platform: "web" });
  }

  function removeLink(index: number) {
    updateField("links", form.links.filter((_, i) => i !== index));
  }

  function updateTags(value: string) {
    updateField("tags", value.split(/[\s,，]+/).filter(Boolean));
  }

  function updatePromotionDefaultTags(value: string) {
    updateField("promotion", { ...form.promotion, defaultTags: value.split(/[\s,，]+/).filter(Boolean) });
  }

  return (
    <Card className="border-border/50 bg-card/60">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Box className="h-5 w-5 text-primary" />
          {product.name ? "编辑产品" : "新增产品"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">产品名称</span>
            <Input 
              value={form.name} 
              onChange={(e) => updateField("name", e.target.value)} 
              placeholder="例如：漫影工作室"
              className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">URL 标识 (slug)</span>
            <Input 
              value={form.slug} 
              onChange={(e) => updateField("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} 
              placeholder="例如：manying-studio"
              className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">一句话描述</span>
          <Input 
            value={form.description} 
            onChange={(e) => updateField("description", e.target.value)} 
            placeholder="简短描述产品用途"
            className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">详细描述 (Markdown)</span>
          <Textarea 
            value={form.detail} 
            onChange={(e) => updateField("detail", e.target.value)} 
            rows={4} 
            placeholder="详细的产品介绍，支持 Markdown 格式"
            className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">封面图路径</span>
          <Input 
            value={form.coverImage} 
            onChange={(e) => updateField("coverImage", e.target.value)} 
            placeholder="/images/product-cover.png"
            className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">标签</span>
          <Input 
            value={form.tags.join(", ")} 
            onChange={(e) => updateTags(e.target.value)} 
            placeholder="用逗号分隔，例如：视频, 创作, AI"
            className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <div className="space-y-3 rounded-lg border border-border/40 bg-background/40 p-4">
          <span className="text-sm font-semibold text-foreground">CTA 链接</span>
          <div className="space-y-2">
            {form.links.map((link, index) => (
              <div 
                key={index} 
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 transition-all duration-200 hover:border-border/70 hover:bg-background/80"
              >
                <span className="truncate text-sm font-medium text-foreground">{link.label}</span>
                <span className="truncate text-xs text-muted-foreground">{link.url}</span>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => removeLink(index)}
                  className="ml-auto h-8 w-8 p-0 transition-all duration-200 hover:scale-110 hover:bg-destructive/10 hover:text-destructive"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Input 
              value={newLink.label} 
              onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} 
              placeholder="按钮文字" 
              className="flex-1 transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Input 
              value={newLink.url} 
              onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} 
              placeholder="链接地址" 
              className="flex-2 transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button 
              size="sm" 
              variant="outline" 
              onClick={addLink} 
              disabled={!newLink.label || !newLink.url}
              className="transition-all duration-200 hover:scale-105 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-border/40 bg-background/40 p-4">
          <span className="text-sm font-semibold text-foreground">推广配置</span>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">默认话题标签</span>
              <Input 
                value={form.promotion.defaultTags.join(", ")} 
                onChange={(e) => updatePromotionDefaultTags(e.target.value)} 
                placeholder="用逗号分隔"
                className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">UTM Campaign</span>
              <Input 
                value={form.promotion.utm.campaign} 
                onChange={(e) => updateField("promotion", { ...form.promotion, utm: { campaign: e.target.value } })} 
                placeholder="例如：manying-studio"
                className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">CTA 类型</span>
              <select
                value={form.promotion.ctaType}
                onChange={(e) => updateField("promotion", { ...form.promotion, ctaType: e.target.value as ProductCtaType })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="access">接入</option>
                <option value="read">阅读</option>
                <option value="download">下载</option>
                <option value="learn_more">了解更多</option>
                <option value="community">加入社区</option>
              </select>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-border/40 pt-5">
          <Button 
            variant="outline" 
            onClick={onCancel}
            className="transition-all duration-200 hover:scale-105"
          >
            取消
          </Button>
          <Button 
            onClick={() => onSave(form)} 
            disabled={!form.name || !form.slug}
            className="gap-1.5 transition-all duration-200 hover:scale-105 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RecordList({ title, empty, icon: Icon, items, feedback, renderActions }: { title: string; empty: string; icon: typeof Radio; items: Array<{ id: string; title: string; description: string; status: string; task?: SelfMediaTask }>; feedback?: string | null; renderActions?: (item: { id: string; title: string; description: string; status: string; task: SelfMediaTask }) => ReactNode }) {
  return (
    <Card className="border-border/50 bg-card/60">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" />{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <div className="rounded-lg border border-dashed border-border/60 px-5 py-10 text-center text-sm text-muted-foreground">{empty}</div> : <div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/50 px-3 py-3 transition-colors hover:bg-background/70"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p></div><div className="flex items-center gap-2"><Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>{item.task && renderActions?.(item as typeof item & { task: SelfMediaTask })}</div></div>)}</div>}
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
  const [journalWarning, setJournalWarning] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getSelfMediaBridge();
    if (!bridge || !activeProjectId || selfMediaProjectId !== activeProjectId) return;
    let disposed = false;
    void bridge.listTasks({ projectId: activeProjectId }).then((reply) => {
      if (
        disposed
        || useProjectStore.getState().activeProjectId !== activeProjectId
        || useSelfMediaStore.getState().activeProjectId !== activeProjectId
      ) return;
      if (!reply.success) {
        setJournalWarning(reply.error.message);
        return;
      }
      setJournalWarning(null);
      replaceProjectTasks(activeProjectId, reply.value);
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [activeProjectId, replaceProjectTasks, selfMediaProjectId]);

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
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border/40 bg-background/40 p-3 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-4">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-200 ${
                  section === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
