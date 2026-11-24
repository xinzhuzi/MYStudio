import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Globe2,
  Loader2,
  Rocket,
  Shield,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/stores/project/project-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useSelfMediaStore } from "@/stores/self-media/self-media-store";
import { useProductStore } from "@/stores/product/product-store";
import { SELF_MEDIA_CAPABILITY_MANIFEST } from "@/lib/self-media/capabilities";
import { validateSelfMediaDraft } from "@/lib/self-media/contracts";
import type { SelfMediaContentType, SelfMediaDraft } from "@/types/self-media";
import {
  BATCH_PUBLISH_INTERVAL_MS,
  PLATFORM_ABBREVIATION,
  buildBatchDrafts,
  buildSummaryReport,
  buildTopicsFromProductDefaultTags,
  createInitialProgress,
  delay,
  findFirstPublishAccount,
  incrementDailyPublishCount,
  isTerminalTaskStatus,
  shouldDoFirstPublishVerification,
  updateProgressItem,
  validateBatchAccounts,
  type BatchProgress,
  type BatchSummaryReport,
} from "@/lib/self-media/batch-publish";
import { BatchAccountSelector } from "./batch-account-selector";

function getSelfMediaBridge() {
  return typeof window === "undefined" ? undefined : window.selfMedia;
}

function getProductBridge() {
  return typeof window === "undefined" ? undefined : window.productBridge;
}

export function BatchPublishView() {
  const { activeProjectId } = useProjectStore();
  const mediaFiles = useMediaStore((state) => state.mediaFiles);
  const accounts = useSelfMediaStore((state) => state.accounts);
  const upsertTask = useSelfMediaStore((state) => state.upsertTask);
  const addHistoryRecord = useSelfMediaStore((state) => state.addHistoryRecord);
  const products = useProductStore((state) => state.products);

  const [contentType, setContentType] = useState<SelfMediaContentType>("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [coverAssetId, setCoverAssetId] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private" | "friends">("public");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [summary, setSummary] = useState<BatchSummaryReport | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  // B1b: Preload products on first mount (same pattern as ComposeView)
  useEffect(() => {
    if (products.length > 0) return;
    const bridge = getProductBridge();
    if (!bridge) return;
    bridge.list().then((reply) => {
      if (reply.success) useProductStore.getState().setProducts(reply.value);
    }).catch(() => { /* silent degrade */ });
  }, [products.length]);

  // B1b: Handle product selection - auto-fill topics from defaultTags
  const handleProductSelect = useCallback((productId: string) => {
    setSelectedProductId(productId);
    const product = products.find((p) => p.id === productId);
    if (product && product.promotion.defaultTags.length > 0) {
      setTopics(buildTopicsFromProductDefaultTags(product.promotion.defaultTags));
    }
  }, [products]);

  const projectMedia = useMemo(
    () => mediaFiles.filter((media) => media.projectId === activeProjectId && (media.type === "video" || media.type === "image") && !media.ephemeral),
    [activeProjectId, mediaFiles],
  );

  const selectedAssets = useMemo(
    () => projectMedia.filter((media) => assetIds.includes(media.id) && Boolean(media.url)),
    [assetIds, projectMedia],
  );

  const selectedCover = useMemo(
    () => projectMedia.find((media) => media.id === coverAssetId && Boolean(media.url)),
    [coverAssetId, projectMedia],
  );

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.includes(account.id)),
    [accounts, selectedAccountIds],
  );

  const needsFirstPublishVerification = useMemo(
    () => shouldDoFirstPublishVerification(selectedAccounts),
    [selectedAccounts],
  );

  const firstPublishAccount = useMemo(
    () => findFirstPublishAccount(selectedAccounts),
    [selectedAccounts],
  );

  // Preview: show differentiated titles for each selected platform
  const titlePreviews = useMemo(() => {
    const platforms = new Set(selectedAccounts.map((a) => a.platform));
    return [...platforms].map((platform) => ({
      platform,
      displayName: SELF_MEDIA_CAPABILITY_MANIFEST[platform].displayName,
      abbreviation: PLATFORM_ABBREVIATION[platform],
      previewTitle: `${title} [${PLATFORM_ABBREVIATION[platform]}]`,
    }));
  }, [selectedAccounts, title]);

  // Build a base draft for validation and batch item construction
  const baseDraft: SelfMediaDraft | null = useMemo(() => {
    if (!activeProjectId) return null;
    // Use the first selected account's platform for validation; batch drafts override per-platform
    const firstPlatform = selectedAccounts[0]?.platform ?? "xhs";
    return {
      id: "self-media-draft-batch",
      projectId: activeProjectId,
      contentType,
      title,
      description,
      topics: topics.split(/[\s,，]+/).filter(Boolean),
      assets: selectedAssets.map((media) => ({
        assetId: media.id,
        projectId: activeProjectId,
        kind: media.type as "video" | "image",
        approvedUrl: media.url,
        thumbnailUrl: media.thumbnailUrl,
      })),
      cover: selectedCover
        ? { assetId: selectedCover.id, projectId: activeProjectId, kind: selectedCover.type as "video" | "image", approvedUrl: selectedCover.url, thumbnailUrl: selectedCover.thumbnailUrl }
        : undefined,
      accountIds: selectedAccountIds,
      visibility,
      platformOptions: { platform: firstPlatform },
      productId: selectedProductId || undefined,
      updatedAt: new Date().toISOString(),
    };
  }, [activeProjectId, contentType, title, description, topics, selectedAssets, selectedCover, selectedAccountIds, visibility, selectedProductId, selectedAccounts]);

  const publish = useCallback(async () => {
    if (!baseDraft || !activeProjectId) {
      setFeedback("请先打开一个项目并填写草稿内容。");
      return;
    }
    const bridge = getSelfMediaBridge();
    if (!bridge) {
      setFeedback("当前运行环境没有自媒体主进程桥接。");
      return;
    }
    if (selectedAccounts.length === 0) {
      setFeedback("请至少选择一个跨平台账号。");
      return;
    }

    setPublishing(true);
    setFeedback(null);
    setSummary(null);

    // 验证账号,识别超限排队的账号
    const validations = validateBatchAccounts(selectedAccounts, contentType);
    const queuedAccountIds = new Set(
      validations.filter((v) => v.queuedNextDay).map((v) => v.accountId)
    );

    const batchItems = buildBatchDrafts({ baseDraft, selectedAccounts, queuedAccountIds });
    let currentProgress = createInitialProgress(batchItems);
    setProgress(currentProgress);

    const startedAt = new Date();
    let firstPublishDone = false;

    // ─── First-publish verification ──────────────────────────────
    // 只要有多个平台就触发,优先用 Twitter,否则用第一个在线账号
    if (needsFirstPublishVerification && firstPublishAccount) {
      const firstPublishIdx = batchItems.findIndex(
        (item) => item.accountId === firstPublishAccount.id,
      );

      if (firstPublishIdx >= 0) {
        const firstItem = batchItems[firstPublishIdx];
        const platformName = SELF_MEDIA_CAPABILITY_MANIFEST[firstItem.platform].displayName;
        currentProgress = updateProgressItem(currentProgress, firstPublishIdx, { status: "publishing" });
        setProgress({ ...currentProgress });

        try {
          const validation = validateSelfMediaDraft(firstItem.draft);
          if (!validation.success) {
            currentProgress = updateProgressItem(currentProgress, firstPublishIdx, {
              status: "failure",
              error: validation.issues.map((i) => i.message).join("；"),
            });
            setProgress({ ...currentProgress });
            setFeedback("首发验证失败，已终止批量发布。");
            setSummary(buildSummaryReport(currentProgress, startedAt));
            setPublishing(false);
            return;
          }

          const reply = await bridge.createTask({
            projectId: activeProjectId,
            providerId: "aitoearn-local",
            draft: validation.value,
          });

          if (!reply.success) {
            currentProgress = updateProgressItem(currentProgress, firstPublishIdx, {
              status: "failure",
              error: reply.error.message,
            });
            setProgress({ ...currentProgress });
            setFeedback(`首发验证（${platformName}）失败，已终止批量发布。`);
            setSummary(buildSummaryReport(currentProgress, startedAt));
            setPublishing(false);
            return;
          }

          const tasks = reply.value;
          const firstTask = tasks[0];
          if (firstTask && firstTask.status === "failure") {
            currentProgress = updateProgressItem(currentProgress, firstPublishIdx, {
              status: "failure",
              taskId: firstTask.id,
              error: firstTask.error?.message ?? "首发验证失败",
            });
            setProgress({ ...currentProgress });
            setFeedback(`首发验证（${platformName}）发布失败，已终止批量发布。`);
            setSummary(buildSummaryReport(currentProgress, startedAt));
            setPublishing(false);
            return;
          }

          // Success: record and proceed with remaining items
          tasks.forEach((task) => {
            upsertTask(task);
            if (isTerminalTaskStatus(task.status)) addHistoryRecord({ ...task, finishedAt: task.updatedAt });
          });
          incrementDailyPublishCount(firstItem.accountId);
          currentProgress = updateProgressItem(currentProgress, firstPublishIdx, {
            status: "success",
            taskId: firstTask?.id,
          });
          setProgress({ ...currentProgress });
          firstPublishDone = true;
        } catch (error) {
          currentProgress = updateProgressItem(currentProgress, firstPublishIdx, {
            status: "failure",
            error: error instanceof Error ? error.message : "首发验证异常",
          });
          setProgress({ ...currentProgress });
          setFeedback(`首发验证（${platformName}）异常，已终止批量发布。`);
          setSummary(buildSummaryReport(currentProgress, startedAt));
          setPublishing(false);
          return;
        }
      }
    }

    // ─── Batch publish remaining items ──────────────────────────
    for (let i = 0; i < batchItems.length; i++) {
      const item = batchItems[i];

      // Skip queued-next-day items
      if (item.queuedNextDay) {
        continue;
      }

      // Skip the first-publish account if already done
      if (firstPublishDone && item.accountId === firstPublishAccount?.id) {
        continue;
      }

      // Enforce interval delay between publishes (not before the first one)
      const isPreviousDone = i > 0 && currentProgress.items[i - 1].status !== "pending";
      if (isPreviousDone || firstPublishDone) {
        await delay(BATCH_PUBLISH_INTERVAL_MS);
      }

      currentProgress = updateProgressItem(currentProgress, i, { status: "publishing" });
      setProgress({ ...currentProgress });

      try {
        const validation = validateSelfMediaDraft(item.draft);
        if (!validation.success) {
          currentProgress = updateProgressItem(currentProgress, i, {
            status: "failure",
            error: validation.issues.map((iss) => iss.message).join("；"),
          });
          setProgress({ ...currentProgress });
          continue; // skip and continue (failure skip per D10)
        }

        const reply = await bridge.createTask({
          projectId: activeProjectId,
          providerId: "aitoearn-local",
          draft: validation.value,
        });

        if (!reply.success) {
          currentProgress = updateProgressItem(currentProgress, i, {
            status: "failure",
            error: reply.error.message,
          });
          setProgress({ ...currentProgress });
          continue;
        }

        const tasks = reply.value;
        const task = tasks[0];
        tasks.forEach((t) => {
          upsertTask(t);
          if (isTerminalTaskStatus(t.status)) addHistoryRecord({ ...t, finishedAt: t.updatedAt });
        });

        if (task && task.status === "failure") {
          currentProgress = updateProgressItem(currentProgress, i, {
            status: "failure",
            taskId: task.id,
            error: task.error?.message ?? "发布失败",
          });
        } else {
          incrementDailyPublishCount(item.accountId);
          currentProgress = updateProgressItem(currentProgress, i, {
            status: "success",
            taskId: task?.id,
          });
        }
        setProgress({ ...currentProgress });
      } catch (error) {
        currentProgress = updateProgressItem(currentProgress, i, {
          status: "failure",
          error: error instanceof Error ? error.message : "发布异常",
        });
        setProgress({ ...currentProgress });
        // Continue to next (failure skip per D10)
      }
    }

    setSummary(buildSummaryReport(currentProgress, startedAt));
    setPublishing(false);
  }, [baseDraft, activeProjectId, selectedAccounts, contentType, needsFirstPublishVerification, firstPublishAccount, upsertTask, addHistoryRecord]);

  return (
    <Card className="border-border/50 bg-card/60">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Globe2 className="h-5 w-5 text-primary" />
          全平台批量发布
        </CardTitle>
        <CardDescription className="mt-1 text-sm text-muted-foreground">
          写一份通用草稿，一键分发到多个平台。自动追加平台标识、执行风控检查。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Content type selector */}
        <div className="flex flex-wrap gap-2">
          {(["video", "image-text"] as const).map((type) => (
            <Button
              key={type}
              variant={contentType === type ? "primary" : "outline"}
              size="sm"
              onClick={() => setContentType(type)}
              className="transition-all duration-200 hover:scale-105"
            >
              {type === "video" ? "视频" : "图文"}
            </Button>
          ))}
        </div>

        {/* B1b: Product association dropdown */}
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

        {/* Title & description */}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">通用标题</span>
            <Input 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              placeholder="各平台自动追加标识" 
              maxLength={80}
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
              onChange={(e) => setAssetIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="" disabled>{projectMedia.length > 0 ? "选择当前项目素材" : "素材库暂无可用"}</option>
              {projectMedia
                .filter((m) => (contentType === "video" ? m.type === "video" : m.type === "image"))
                .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>

        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">通用描述</span>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="各平台自动适配字数限制"
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
              onChange={(e) => setTopics(e.target.value)} 
              placeholder="#漫剧 #剧情解说"
              className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">封面素材</span>
            <select
              aria-label="封面素材"
              value={coverAssetId}
              onChange={(e) => setCoverAssetId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">选择封面（视频发布必选）</option>
              {projectMedia.filter((m) => m.type === "image").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">可见范围</span>
            <select
              aria-label="可见范围"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "public" | "private" | "friends")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="public">公开</option>
              <option value="private">仅自己</option>
              <option value="friends">好友可见</option>
            </select>
          </label>
        </div>

        {/* Cross-platform account selector */}
        <div className="space-y-3 border-t border-border/40 pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Shield className="h-4 w-4 text-primary" />
            跨平台账号选择
          </h3>
          <BatchAccountSelector
            accounts={accounts}
            contentType={contentType}
            selectedAccountIds={selectedAccountIds}
            onSelectionChange={setSelectedAccountIds}
          />
        </div>

        {/* Title previews per platform */}
        {titlePreviews.length > 0 && title && (
          <div className="space-y-2 rounded-lg border border-border/40 bg-background/40 p-3">
            <p className="text-xs font-semibold text-foreground">各平台标题预览（自动追加标识）</p>
            {titlePreviews.map((preview) => (
              <div key={preview.platform} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="shrink-0 text-xs">{preview.displayName}</Badge>
                <span className="truncate text-muted-foreground">{preview.previewTitle}</span>
              </div>
            ))}
          </div>
        )}

        {/* First-publish verification notice */}
        {needsFirstPublishVerification && firstPublishAccount && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-foreground">
              首发验证：将先在 {SELF_MEDIA_CAPABILITY_MANIFEST[firstPublishAccount.platform].displayName}（{firstPublishAccount.displayName}）单发 1 条，成功后再触发其余平台。
            </span>
          </div>
        )}

        {/* Risk control notice */}
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          <span>
            风控：发布间隔 ≥ 5 分钟 · 每账号每日上限 3 条 · 自动追加平台标识
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 border-t border-border/40 pt-4">
          <Button
            className="gap-2 transition-all duration-200 hover:scale-105"
            onClick={publish}
            disabled={publishing || !baseDraft || selectedAccounts.length === 0 || !getSelfMediaBridge()}
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {publishing ? "发布中…" : "一键全平台发布"}
          </Button>
          {selectedAccountIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              已选 {selectedAccountIds.length} 个账号 · 预计 {Math.ceil(selectedAccountIds.length * 5)} 分钟
            </span>
          )}
        </div>

        {/* Progress bar (UX trio #1) */}
        {progress && (
          <div className="space-y-3 rounded-lg border border-border/40 bg-background/40 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">发布进度</span>
              <span className="text-muted-foreground">
                已完成 {progress.completed}/{progress.total}
                {progress.estimatedRemainingMinutes > 0 && ` · 预计剩余 ${progress.estimatedRemainingMinutes} 分钟`}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
              />
            </div>
            {/* Per-item status */}
            <div className="space-y-1.5">
              {progress.items.map((item, idx) => (
                <div key={`${item.platform}-${item.accountId}-${idx}`} className="flex items-center gap-2 text-xs">
                  {item.status === "success" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
                  {item.status === "failure" && <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                  {item.status === "publishing" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                  {item.status === "pending" && <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30" />}
                  {item.status === "skipped" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  {item.status === "queued-next-day" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" />}
                  <Badge variant="outline" className="shrink-0 text-[10px]">{SELF_MEDIA_CAPABILITY_MANIFEST[item.platform].displayName}</Badge>
                  <span className="truncate text-foreground">{item.displayName}</span>
                  {item.status === "queued-next-day" && <span className="text-xs text-warning">（排队次日）</span>}
                  {item.error && <span className="truncate text-destructive">{item.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary report */}
        {summary && (
          <div className="space-y-2 rounded-lg border border-border/40 bg-background/50 p-4">
            <h4 className="text-sm font-semibold text-foreground">发布汇总报告</h4>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-success">✓ 成功 {summary.succeeded}</span>
              <span className="text-destructive">✗ 失败 {summary.failed}</span>
              <span className="text-muted-foreground">⊘ 跳过 {summary.skipped}</span>
              <span className="text-muted-foreground">耗时 {summary.duration}</span>
            </div>
            {summary.failures.length > 0 && (
              <div className="space-y-1.5 border-t border-border/40 pt-2">
                <p className="text-xs font-medium text-muted-foreground">失败详情：</p>
                {summary.failures.map((f, idx) => (
                  <p key={idx} className="text-xs text-destructive">
                    [{SELF_MEDIA_CAPABILITY_MANIFEST[f.platform].displayName}] {f.displayName}：{f.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feedback */}
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
