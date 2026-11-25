import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/stores/project/project-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useSelfMediaStore } from "@/stores/self-media/self-media-store";
import { useProductStore } from "@/stores/product/product-store";
import { useTemplateStore } from "@/stores/template/template-store";
import { getSelfMediaCapabilities, isSelfMediaPublishable } from "@/lib/self-media/capabilities";
import { validateSelfMediaDraft } from "@/lib/self-media/contracts";
import { buildTemplateFill, checkForbiddenWords, mergeTopicStrings } from "@/lib/self-media/template-engine";
import { resolveProductAutoFill, type AutoFillState } from "@/lib/self-media/product-autofill";
import type { SelfMediaContentType, SelfMediaDraft, SelfMediaPlatform } from "@/types/self-media";
import { getProductBridge, getSelfMediaBridge, isTerminalTaskStatus, selfMediaPlatformCapabilities } from "./view-helpers";
import { buildUtmUrl, copyUtmToClipboard } from "@/lib/self-media/utm";

export function ComposeView() {
  const { activeProjectId } = useProjectStore();
  const mediaFiles = useMediaStore((state) => state.mediaFiles);
  const accounts = useSelfMediaStore((state) => state.accounts);
  const saveDraft = useSelfMediaStore((state) => state.saveDraft);
  const upsertTask = useSelfMediaStore((state) => state.upsertTask);
  const addHistoryRecord = useSelfMediaStore((state) => state.addHistoryRecord);
  const products = useProductStore((state) => state.products);
  const templates = useTemplateStore((state) => state.templates);
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
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

  // B5/L3: 预加载模板列表(与 TemplateView 相同的 fire-and-forget 范式)
  useEffect(() => {
    if (templates.length > 0) return;
    void useTemplateStore.getState().loadTemplates();
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

  // B5/L3: 当前产品可用模板(从模板填充)
  const productTemplates = useMemo(
    () => templates.filter((t) => t.productId === selectedProductId),
    [templates, selectedProductId],
  );

  // B5/L3: 选中模板即渲染。复审修复:标题/描述仅填充空字段,不覆盖用户已输入
  // 内容(防「先手写再选模板」丢稿);话题走合并天然保留既有内容。
  const handleTemplateFill = useCallback((templateId: string) => {
    if (!templateId) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template || !selectedProduct) return;
    setSelectedTemplateId(templateId);
    const fill = buildTemplateFill({
      template,
      productName: selectedProduct.name,
      productDescription: selectedProduct.description,
      productLink: selectedProduct.links[0]?.url,
      brandProfile: selectedProduct.brandProfile,
      platform,
    });
    setTitle((current) => (current.trim() ? current : fill.title));
    setDescription((current) => (current.trim() ? current : fill.description));
    if (fill.topicString) setTopics((current) => mergeTopicStrings(current, fill.topicString));
  }, [templates, selectedProduct, platform]);
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

  // A7(1125 补检): 自动填入值记录——字段为空、或仍等于上次自动填入值时才随产品替换,
  // 用户改过的字段(先写后选)不丢稿;取消关联时仅清掉仍属于自己的字段。
  const autoFillRef = useRef<AutoFillState>({});

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    setSelectedTemplateId(""); // 产品切换后模板列表变化,复位选中态
    const product = products.find((p) => p.id === productId) ?? null;
    const { values, applied } = resolveProductAutoFill({
      source: product
        ? {
            description: product.description,
            topics: product.promotion.defaultTags.map((tag) => `#${tag}`).join(" "),
            utmBaseUrl: product.links[0]?.url ?? "",
          }
        : null,
      current: { description, topics, utmBaseUrl },
      lastApplied: autoFillRef.current,
    });
    autoFillRef.current = applied;
    if (values.description !== undefined) setDescription(values.description);
    if (values.topics !== undefined) setTopics(values.topics);
    if (values.utmBaseUrl !== undefined) setUtmBaseUrl(values.utmBaseUrl);
  };

  // A6(1125 补检): 关联产品后,对当前标题+描述实时检查品牌禁用词;命中即红字提示并禁用发布
  const forbiddenHits = useMemo(() => {
    if (!selectedProduct) return [];
    return checkForbiddenWords(`${title}\n${description}`, selectedProduct.brandProfile?.forbiddenWords ?? []);
  }, [selectedProduct, title, description]);
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
        // L1(复审): 单发草稿带上产品关联(与批量路径一致)——IPC 透传只对已带 productId
        // 的草稿生效;store 草稿经 saveDraft/validateSelfMediaDraft 保留该字段,重试链一并闭合
        productId: selectedProductId || undefined,
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
    <Card className="border-border/50 bg-card/80">
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
        {/* B4 推广链接生成器 */}
        {selectedProduct && (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/10 p-4">
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
              <div className="rounded-md bg-background/80 p-2.5">
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
        {forbiddenHits.length > 0 && (
          <p className="text-xs text-destructive">禁用词：{forbiddenHits.join("、")}</p>
        )}
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
          <div className="grid gap-4 rounded-lg border border-border/40 bg-background/80 p-4 md:grid-cols-2">
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
              disabled={publishing || !supportsCurrentContentType || !getSelfMediaBridge() || forbiddenHits.length > 0}
            >
              {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
              {publishMode === "scheduled" ? "创建定时任务" : "立即发布"}
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/80 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">明确选择发布账号</p>
          <p className="mb-3 text-xs text-muted-foreground">仅展示支持当前内容类型的在线账号</p>
          {selectedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前平台没有可用账号，请先在"账号"视图连接并刷新。</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedAccounts.map((account) => (
                <label 
                  key={account.id} 
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border/50 bg-background/80 px-3 py-2.5 text-sm transition-all duration-200 hover:border-primary/50 hover:bg-background/90"
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
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="text-foreground">{feedback}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
