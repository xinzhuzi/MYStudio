import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTemplateStore } from "@/stores/template/template-store";
import { SELF_MEDIA_CAPABILITY_MANIFEST } from "@/lib/self-media/capabilities";
import { validateSelfMediaDraft } from "@/lib/self-media/contracts";
import { buildTemplateFill, checkForbiddenWords, mergeTopicStrings } from "@/lib/self-media/template-engine";
import { resolveProductAutoFill, type AutoFillState } from "@/lib/self-media/product-autofill";
import type { SelfMediaContentType, SelfMediaDraft, SelfMediaTask } from "@/types/self-media";
import {
  PLATFORM_ABBREVIATION,
  buildBatchDrafts,
  buildBatchProgressFromTasks,
  buildDifferentiatedTitle,
  buildSummaryReport,
  buildTopicsFromProductDefaultTags,
  checkBatchTaskLimit,
  findEligibleFirstPublishAccount,
  isBatchComplete,
  planBatchSchedule,
  shouldDoFirstPublishVerification,
  validateBatchAccounts,
  type BatchCreationFailure,
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

function newBatchId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `batch-${crypto.randomUUID()}`
    : `batch-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** 建单回执入账:项目对不上时丢弃该条(进度投影读的是 store 里的任务列表) */
function adoptCreatedTasks(tasks: readonly SelfMediaTask[]) {
  const store = useSelfMediaStore.getState();
  for (const task of tasks) {
    if (task.projectId !== store.activeProjectId) continue;
    try {
      store.upsertTask(task);
    } catch {
      return;
    }
  }
}

export function BatchPublishView() {
  const { activeProjectId } = useProjectStore();
  const mediaFiles = useMediaStore((state) => state.mediaFiles);
  const accounts = useSelfMediaStore((state) => state.accounts);
  const tasks = useSelfMediaStore((state) => state.tasks);
  const products = useProductStore((state) => state.products);
  const templates = useTemplateStore((state) => state.templates);

  const [contentType, setContentType] = useState<SelfMediaContentType>("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [coverAssetId, setCoverAssetId] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private" | "friends">("public");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  // L6: 当日计数来自主进程台账(dailyPublishStats IPC),挂载/任务变化/点击发布时刷新
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  // L6: 本次点击的批次;进度面板是任务列表按 batchId 的投影
  const [batchId, setBatchId] = useState<string | null>(null);
  const [creationFailures, setCreationFailures] = useState<BatchCreationFailure[]>([]);
  const [batchStartedAt, setBatchStartedAt] = useState<Date | null>(null);

  // B1b: Preload products on first mount (same pattern as ComposeView)
  useEffect(() => {
    if (products.length > 0) return;
    const bridge = getProductBridge();
    if (!bridge) return;
    bridge.list().then((reply) => {
      if (reply.success) useProductStore.getState().setProducts(reply.value);
    }).catch(() => { /* silent degrade */ });
  }, [products.length]);

  // B5: Preload templates on first mount (same fire-and-forget pattern as TemplateView)
  useEffect(() => {
    if (templates.length > 0) return;
    void useTemplateStore.getState().loadTemplates();
  }, [templates.length]);

  const refreshDailyCounts = useCallback(async () => {
    const bridge = getSelfMediaBridge();
    if (!bridge?.dailyPublishStats) return;
    const reply = await bridge.dailyPublishStats().catch(() => undefined);
    if (reply && reply.success) setDailyCounts(reply.value.counts);
  }, []);

  // 挂载时与任务状态变化时各取一次(选择器里的排队预告要与点击时的判定一致)
  useEffect(() => {
    void refreshDailyCounts();
  }, [refreshDailyCounts, tasks]);

  // A8(1125 补检): 自动填入值记录——话题/描述为空、或仍等于上次自动填入值时才随产品替换,
  // 新产品无默认话题时清掉残留(不再沿用上一个产品的话题),用户改过的字段不丢稿。
  const productAutoFillRef = useRef<AutoFillState>({});

  const handleProductSelect = useCallback((productId: string) => {
    setSelectedProductId(productId);
    setSelectedTemplateId(""); // 产品切换后模板列表变化,复位选中态
    const product = products.find((p) => p.id === productId) ?? null;
    const { values, applied } = resolveProductAutoFill({
      source: product
        ? {
            description: product.description,
            topics: buildTopicsFromProductDefaultTags(product.promotion.defaultTags),
          }
        : null,
      current: { description, topics },
      lastApplied: productAutoFillRef.current,
    });
    productAutoFillRef.current = applied;
    if (values.description !== undefined) setDescription(values.description);
    if (values.topics !== undefined) setTopics(values.topics);
  }, [products, description, topics]);

  // A6(1125 补检): 关联产品后,对当前标题+描述实时检查品牌禁用词;命中即红字提示并禁用发布
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const forbiddenHits = useMemo(() => {
    if (!selectedProduct) return [];
    return checkForbiddenWords(`${title}\n${description}`, selectedProduct.brandProfile?.forbiddenWords ?? []);
  }, [selectedProduct, title, description]);

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

  // B5/L3: templates of the selected product (从模板填充)
  const productTemplates = useMemo(
    () => templates.filter((t) => t.productId === selectedProductId),
    [templates, selectedProductId],
  );

  // B5/L3: 选中模板即渲染预填。复审修复:标题/描述仅填充空字段,不覆盖用户已输入
  // 内容(防「先手写再选模板」丢稿);话题走合并天然保留既有内容。
  const handleTemplateFill = useCallback((templateId: string) => {
    if (!templateId) return;
    const template = templates.find((t) => t.id === templateId);
    const product = products.find((p) => p.id === selectedProductId);
    if (!template || !product) return;
    setSelectedTemplateId(templateId);
    const fill = buildTemplateFill({
      template,
      productName: product.name,
      productDescription: product.description,
      productLink: product.links[0]?.url,
      brandProfile: product.brandProfile,
      // 通用预填:用首个选中账号的平台渲染 {{platform}};发布时各账号仍走差异化/裁剪
      platform: selectedAccounts[0]?.platform ?? template.platform,
    });
    setTitle((current) => (current.trim() ? current : fill.title));
    setDescription((current) => (current.trim() ? current : fill.description));
    if (fill.topicString) setTopics((current) => mergeTopicStrings(current, fill.topicString));
  }, [templates, products, selectedProductId, selectedAccounts]);

  // L6: 今日超限(排队次日)账号集合——基于主进程台账的当日计数
  const queuedAccountIds = useMemo(
    () => new Set(validateBatchAccounts(selectedAccounts, contentType, dailyCounts).filter((v) => v.queuedNextDay).map((v) => v.accountId)),
    [selectedAccounts, contentType, dailyCounts],
  );

  const eligibleAccounts = useMemo(
    () => selectedAccounts.filter((account) => !queuedAccountIds.has(account.id)),
    [selectedAccounts, queuedAccountIds],
  );

  const needsFirstPublishVerification = useMemo(
    () => shouldDoFirstPublishVerification(eligibleAccounts),
    [eligibleAccounts],
  );

  const firstPublishAccount = useMemo(
    () => findEligibleFirstPublishAccount(selectedAccounts, queuedAccountIds),
    [selectedAccounts, queuedAccountIds],
  );

  // Preview: show differentiated titles for each selected platform
  // A1(1125 补检): 预览与建单共用 buildDifferentiatedTitle,保证「预览===实发」
  const titlePreviews = useMemo(() => {
    const platforms = new Set(selectedAccounts.map((a) => a.platform));
    return [...platforms].map((platform) => ({
      platform,
      displayName: SELF_MEDIA_CAPABILITY_MANIFEST[platform].displayName,
      abbreviation: PLATFORM_ABBREVIATION[platform],
      previewTitle: buildDifferentiatedTitle(title, platform),
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

  // L6: 进度面板=任务列表按 batchId 的投影。本次点击的批次优先;
  // 重挂载后取本项目任务里 createdAt 最新的那个 batchId。
  const activeBatchId = useMemo(() => {
    if (batchId) return batchId;
    const latest = tasks
      .filter((task) => task.projectId === activeProjectId && task.batchId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return latest?.batchId ?? null;
  }, [batchId, tasks, activeProjectId]);

  const progress: BatchProgress | null = useMemo(() => {
    if (!activeBatchId) return null;
    return buildBatchProgressFromTasks({
      batchId: activeBatchId,
      tasks,
      accounts,
      creationFailures: batchId === activeBatchId ? creationFailures : [],
    });
  }, [activeBatchId, batchId, tasks, accounts, creationFailures]);

  const batchBusy = useMemo(
    () => Boolean(progress && !isBatchComplete(progress)),
    [progress],
  );

  // 汇总报告在本批全部结束时显示(排队次日项不算未完)
  const summary: BatchSummaryReport | null = useMemo(() => {
    if (!progress || !isBatchComplete(progress)) return null;
    const startedAt = batchStartedAt
      ?? new Date(tasks
        .filter((task) => task.batchId === activeBatchId)
        .map((task) => task.createdAt)
        .sort()[0] ?? Date.now());
    return buildSummaryReport(progress, startedAt);
  }, [progress, batchStartedAt, tasks, activeBatchId]);

  const publish = useCallback(async () => {
    if (!baseDraft || !activeProjectId) {
      setFeedback("请先打开一个项目并填写草稿内容。");
      return;
    }
    const bridge = getSelfMediaBridge();
    if (!bridge?.createTask) {
      setFeedback("当前运行环境没有自媒体主进程桥接。");
      return;
    }
    if (selectedAccounts.length === 0) {
      setFeedback("请至少选择一个跨平台账号。");
      return;
    }
    // L5: 单批次任务数上限拦截(超限不创建任何 task)
    const batchLimit = checkBatchTaskLimit(selectedAccounts.length);
    if (batchLimit.exceeded) {
      setFeedback(`单批次最多 ${batchLimit.limit} 个任务，当前选中 ${batchLimit.count} 个账号，请减少账号后重试。`);
      return;
    }
    if (batchBusy) {
      setFeedback("上一批还有未完成的任务，等它们结束后再建新批次。");
      return;
    }

    setPublishing(true);
    setFeedback(null);

    // 点击发布时取一次当日计数,排队判定以最新值为准
    await refreshDailyCounts();
    const freshCounts = { ...dailyCounts };
    const freshReply = await bridge.dailyPublishStats?.().catch(() => undefined);
    if (freshReply && freshReply.success) {
      Object.assign(freshCounts, freshReply.value.counts);
      setDailyCounts(freshReply.value.counts);
    }

    const validations = validateBatchAccounts(selectedAccounts, contentType, freshCounts);
    const queuedIds = new Set(validations.filter((v) => v.queuedNextDay).map((v) => v.accountId));

    const batchItems = buildBatchDrafts({ baseDraft, selectedAccounts, queuedAccountIds: queuedIds });
    const verificationAccount = findEligibleFirstPublishAccount(selectedAccounts, queuedIds);
    const needsVerification = shouldDoFirstPublishVerification(
      selectedAccounts.filter((account) => !queuedIds.has(account.id)),
    );

    const nextBatchId = newBatchId();
    const slots = planBatchSchedule({
      items: batchItems,
      now: new Date(),
      batchId: nextBatchId,
      verificationAccountId: needsVerification ? verificationAccount?.id ?? null : null,
    });

    setBatchId(nextBatchId);
    setCreationFailures([]);
    setBatchStartedAt(new Date());

    const failures: BatchCreationFailure[] = [];
    let aborted = false;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      const isFirstVerificationSlot = index === 0 && slot.role === "verification";
      if (isFirstVerificationSlot) {
        const platformName = SELF_MEDIA_CAPABILITY_MANIFEST[slot.item.platform]?.displayName ?? slot.item.platform;
        const abortVerification = (detail: string) => {
          failures.push({ accountId: slot.item.accountId, platform: slot.item.platform, displayName: slot.item.displayName, error: detail });
          // 首槽是首发验证且建单失败:不建其余,沿用现有文案
          setFeedback(`首发验证（${platformName}）失败，已终止批量发布。`);
          aborted = true;
        };
        const validation = validateSelfMediaDraft(slot.draft);
        if (!validation.success) {
          abortVerification(validation.issues.map((i) => i.message).join("；"));
          break;
        }
        try {
          const reply = await bridge.createTask({ projectId: activeProjectId, providerId: "aitoearn-local", draft: validation.value });
          if (!reply.success) {
            abortVerification(reply.error.message);
            break;
          }
          adoptCreatedTasks(reply.value);
        } catch (error) {
          abortVerification(error instanceof Error ? error.message : "首发验证建单异常");
          break;
        }
        continue;
      }
      try {
        const validation = validateSelfMediaDraft(slot.draft);
        if (!validation.success) {
          failures.push({
            accountId: slot.item.accountId,
            platform: slot.item.platform,
            displayName: slot.item.displayName,
            error: validation.issues.map((iss) => iss.message).join("；"),
          });
          continue; // 失败跳过、继续(D10)
        }
        const reply = await bridge.createTask({ projectId: activeProjectId, providerId: "aitoearn-local", draft: validation.value });
        if (!reply.success) {
          failures.push({ accountId: slot.item.accountId, platform: slot.item.platform, displayName: slot.item.displayName, error: reply.error.message });
          continue;
        }
        adoptCreatedTasks(reply.value);
      } catch (error) {
        failures.push({
          accountId: slot.item.accountId,
          platform: slot.item.platform,
          displayName: slot.item.displayName,
          error: error instanceof Error ? error.message : "建单异常",
        });
      }
    }
    setCreationFailures(failures);
    if (!aborted && failures.length > 0) {
      setFeedback(`${failures.length} 个任务建单失败，详见进度面板。`);
    }
    setPublishing(false);
  }, [baseDraft, activeProjectId, selectedAccounts, contentType, batchBusy, dailyCounts, refreshDailyCounts]);

  return (
    <Card className="border-border/50 bg-card/80">
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

        {/* B5/L3: 从模板填充——渲染 titleTemplate/bodyTemplate,仅填充空字段 */}
        {selectedProductId && productTemplates.length > 0 && (
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">从模板填充</span>
            <select
              aria-label="从模板填充"
              value={selectedTemplateId}
              onChange={(event) => handleTemplateFill(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-all duration-200 hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">选择该产品的模板（仅填充空标题/描述）</option>
              {productTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
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
        {forbiddenHits.length > 0 && (
          <p className="text-xs text-destructive">禁用词：{forbiddenHits.join("、")}</p>
        )}

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
            dailyCounts={dailyCounts}
            selectedAccountIds={selectedAccountIds}
            onSelectionChange={setSelectedAccountIds}
          />
        </div>

        {/* Title previews per platform */}
        {titlePreviews.length > 0 && title && (
          <div className="space-y-2 rounded-lg border border-border/40 bg-background/80 p-3">
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
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-foreground">
              首发验证：将先在 {SELF_MEDIA_CAPABILITY_MANIFEST[firstPublishAccount.platform].displayName}（{firstPublishAccount.displayName}）单发 1 条，成功后再触发其余平台。
            </span>
          </div>
        )}

        {/* Risk control notice */}
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
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
            disabled={publishing || batchBusy || !baseDraft || selectedAccounts.length === 0 || !getSelfMediaBridge() || forbiddenHits.length > 0}
            aria-busy={publishing || batchBusy}
          >
            {publishing || batchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {publishing || batchBusy ? "发布中…" : "一键全平台发布"}
          </Button>
          {selectedAccountIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              已选 {selectedAccountIds.length} 个账号 · 预计 {Math.ceil(selectedAccountIds.length * 5)} 分钟
            </span>
          )}
        </div>

        {/* Progress panel: 任务列表按 batchId 的投影 + 建单失败项 */}
        {progress && (
          <div className="space-y-3 rounded-lg border border-border/40 bg-background/80 p-4">
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
                <div key={`${item.platform ?? "unknown"}-${item.accountId}-${idx}`} className="flex items-center gap-2 text-xs">
                  {item.status === "success" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
                  {item.status === "failure" && <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                  {item.status === "publishing" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                  {item.status === "pending" && <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30" />}
                  {item.status === "skipped" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  {item.status === "queued-next-day" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" />}
                  {/* 平台徽标只在有可靠 platform 来源时显示(旧任务缺字段不假定) */}
                  {item.platform && <Badge variant="outline" className="shrink-0 text-[10px]">{SELF_MEDIA_CAPABILITY_MANIFEST[item.platform].displayName}</Badge>}
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
          <div className="space-y-2 rounded-lg border border-border/40 bg-background/80 p-4">
            <h4 className="text-sm font-semibold text-foreground">发布汇总报告</h4>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-success">✓ 成功 {summary.succeeded}</span>
              <span className="text-destructive">✗ 失败 {summary.failed}</span>
              {summary.skipped > 0 && <span className="text-muted-foreground">⊘ 跳过 {summary.skipped}</span>}
              {summary.queued > 0 && <span className="text-warning">⏱ 排队次日 {summary.queued}</span>}
              <span className="text-muted-foreground">耗时 {summary.duration}</span>
            </div>
            {summary.failures.length > 0 && (
              <div className="space-y-1.5 border-t border-border/40 pt-2">
                <p className="text-xs font-medium text-muted-foreground">失败详情：</p>
                {summary.failures.map((f, idx) => (
                  <p key={idx} className="text-xs text-destructive">
                    {f.platform ? `[${SELF_MEDIA_CAPABILITY_MANIFEST[f.platform].displayName}] ` : ""}{f.displayName}：{f.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="text-foreground">{feedback}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
