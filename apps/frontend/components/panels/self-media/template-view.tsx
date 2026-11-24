import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, Eye, EyeOff, FileText, Pencil, Plus, Save, Settings2, ShieldAlert, Trash2, Type } from "lucide-react";
import { useProductStore } from "@/stores/product/product-store";
import { useTemplateStore } from "@/stores/template/template-store";
import type { PromotionTemplate } from "@/types/promotion-template";
import type { SelfMediaPlatform } from "@/types/self-media";
import { PLATFORM_ABBREVIATION } from "@/lib/self-media/batch-publish";
import {
  renderMultiPlatformPreview,
  type PlatformPreview,
} from "@/lib/self-media/template-engine";

const TEMPLATE_VARIABLES = [
  { key: "{{product.name}}", description: "产品名称" },
  { key: "{{product.description}}", description: "产品描述" },
  { key: "{{product.link}}", description: "产品链接" },
  { key: "{{date}}", description: "发布日期" },
  { key: "{{platform}}", description: "平台名称（自动注入）" },
] as const;

export function TemplateView() {
  const { products } = useProductStore();
  const { templates, loading, loadTemplates, saveTemplate, deleteTemplate } = useTemplateStore();
  const [editingTemplate, setEditingTemplate] = useState<PromotionTemplate | null>(null);
  const [selectedProductFilter, setSelectedProductFilter] = useState<string>("all");

  useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时加载一次

  const filteredTemplates = selectedProductFilter === "all"
    ? templates
    : templates.filter((t) => t.productId === selectedProductFilter);

  const handleCreateNew = () => {
    setEditingTemplate({
      id: "",
      productId: products[0]?.id || "",
      name: "",
      platform: "xhs" as SelfMediaPlatform,
      titleTemplate: "",
      bodyTemplate: "",
      defaultTags: [],
      mediaSlots: 9,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const handleEdit = (template: PromotionTemplate) => {
    setEditingTemplate({ ...template });
  };

  const handleDelete = async (id: string) => {
    // TODO: 替换为应用内确认对话框
    const confirmed = window.confirm("确定要删除这个模板吗？");
    if (confirmed) {
      await deleteTemplate(id);
    }
  };

  const handleSave = async (template: PromotionTemplate) => {
    await saveTemplate(template);
    setEditingTemplate(null);
  };

  if (editingTemplate) {
    const product = products.find((p) => p.id === editingTemplate.productId);
    return (
      <TemplateEditor
        template={editingTemplate}
        product={product}
        onSave={handleSave}
        onCancel={() => setEditingTemplate(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            推广模板
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            创建可复用的内容模板，自动适配不同平台并执行风控检查
          </p>
        </div>
        <Button 
          onClick={handleCreateNew} 
          disabled={products.length === 0}
          className="gap-1.5 transition-all duration-200 hover:scale-105 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          新建模板
        </Button>
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-background/30 px-6 py-16 text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-4 text-base font-medium text-muted-foreground">
            请先创建产品
          </p>
          <p className="mt-1 text-sm text-muted-foreground/80">
            在"产品"标签中创建至少一个产品，然后才能创建推广模板
          </p>
        </div>
      ) : (
        <>
          <div>
            <Label className="text-sm font-medium text-foreground">按产品筛选</Label>
            <Select value={selectedProductFilter} onValueChange={setSelectedProductFilter}>
              <SelectTrigger className="mt-2 w-64 transition-all duration-200 hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20">
                <SelectValue placeholder="按产品筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有产品</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                <span className="text-base">加载中...</span>
              </div>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-background/30 px-6 py-16 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-base font-medium text-muted-foreground">
                暂无模板
              </p>
              <p className="mt-1 text-sm text-muted-foreground/80">
                点击"新建模板"开始创建推广模板
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredTemplates.map((template) => {
                const product = products.find((p) => p.id === template.productId);
                return (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    productName={product?.name || "未知产品"}
                    onEdit={() => handleEdit(template)}
                    onDelete={() => handleDelete(template.id)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  productName,
  onEdit,
  onDelete,
}: {
  template: PromotionTemplate;
  productName: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const platformLabel = PLATFORM_ABBREVIATION[template.platform] || template.platform;
  
  return (
    <Card className="group border-border/50 bg-card/60 transition-all duration-200 hover:border-border/70 hover:bg-card/80">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="truncate text-base font-semibold text-foreground">
              {template.name}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs font-medium">{productName}</Badge>
              <Badge variant="outline" className="text-xs">{platformLabel}</Badge>
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onEdit}
              className="gap-1 transition-all duration-200 hover:scale-105 hover:bg-primary/10"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onDelete}
              className="gap-1 transition-all duration-200 hover:scale-105 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2.5 text-sm">
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-medium text-foreground">标题模板:</span>
            <span className="truncate text-muted-foreground">{template.titleTemplate || "(空)"}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-medium text-foreground">正文模板:</span>
            <span className="line-clamp-2 text-muted-foreground">{template.bodyTemplate || "(空)"}</span>
          </div>
          {template.defaultTags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-medium">默认标签:</span>
              {template.defaultTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateEditor({
  template,
  product,
  onSave,
  onCancel,
}: {
  template: PromotionTemplate;
  product?: ReturnType<typeof useProductStore.getState>["products"][number];
  onSave: (template: PromotionTemplate) => void;
  onCancel: () => void;
}) {
  const { products } = useProductStore();
  const [form, setForm] = useState<PromotionTemplate>(template);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPlatforms, setPreviewPlatforms] = useState<SelfMediaPlatform[]>([
    "xhs",
    "douyin",
    "wxSph",
  ]);

  const handleFieldChange = <K extends keyof PromotionTemplate>(
    field: K,
    value: PromotionTemplate[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      // TODO: 替换为 toast 通知或表单验证
      window.alert("请输入模板名称");
      return;
    }
    onSave(form);
  };

  const insertVariable = (variable: string, target: "title" | "body") => {
    if (target === "title") {
      handleFieldChange("titleTemplate", form.titleTemplate + variable);
    } else {
      handleFieldChange("bodyTemplate", form.bodyTemplate + variable);
    }
  };

  // Use the passed product prop, fall back to store lookup if productId changes
  const currentProduct = product && product.id === form.productId 
    ? product 
    : products.find((p) => p.id === form.productId);
  const brandProfile = currentProduct?.brandProfile;

  const previewResults: PlatformPreview[] = showPreview
    ? renderMultiPlatformPreview({
        template: form,
        productName: currentProduct?.name || "示例产品",
        productDescription: currentProduct?.description || "示例描述",
        productLink: currentProduct?.links[0]?.url || "https://example.com",
        brandProfile,
        targetPlatforms: previewPlatforms,
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <FileText className="h-5 w-5 text-primary" />
          {template.id ? "编辑模板" : "新建模板"}
        </h2>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleSubmit} className="gap-1.5 hover:scale-105">
            <Save className="h-4 w-4" />
            保存
          </Button>
        </div>
      </div>

      <Card className="border-border/50 bg-card/60">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Settings2 className="h-4 w-4 text-primary" />
            基本信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">模板名称</Label>
              <Input
                value={form.name}
                onChange={(e) => handleFieldChange("name", e.target.value)}
                placeholder="例如：小红书种草模板"
                className="transition-all duration-200 hover:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">关联产品</Label>
              <Select
                value={form.productId}
                onValueChange={(v) => handleFieldChange("productId", v)}
              >
                <SelectTrigger className="w-full transition-all duration-200 hover:border-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">目标平台</Label>
              <Select
                value={form.platform}
                onValueChange={(v) => handleFieldChange("platform", v as SelfMediaPlatform)}
              >
                <SelectTrigger className="w-full transition-all duration-200 hover:border-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATFORM_ABBREVIATION).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">媒体槽位数量</Label>
              <Input
                type="number"
                min="0"
                max="20"
                value={form.mediaSlots}
                onChange={(e) => handleFieldChange("mediaSlots", parseInt(e.target.value) || 0)}
                className="transition-all duration-200 hover:border-primary/50"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {brandProfile && (brandProfile.tone.length > 0 || brandProfile.forbiddenWords.length > 0) && (
        <Card className="border-border/50 bg-card/60">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ShieldAlert className="h-4 w-4 text-primary" />
              品牌约束
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {brandProfile.tone.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">语气关键词</p>
                <div className="flex flex-wrap gap-1.5">
                  {brandProfile.tone.map((word) => (
                    <Badge key={word} variant="secondary" className="text-xs font-normal">
                      {word}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {brandProfile.forbiddenWords.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">禁用词</p>
                <div className="flex flex-wrap gap-1.5">
                  {brandProfile.forbiddenWords.map((word) => (
                    <Badge key={word} variant="destructive" className="text-xs font-normal">
                      {word}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50 bg-card/60">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Type className="h-4 w-4 text-primary" />
            模板内容
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">标题模板</Label>
            <Textarea
              value={form.titleTemplate}
              onChange={(e) => handleFieldChange("titleTemplate", e.target.value)}
              placeholder="使用 {{变量}} 插入动态内容，例如：{{product.name}} - {{date}}"
              rows={2}
              className="transition-all duration-200 hover:border-primary/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">正文模板</Label>
            <Textarea
              value={form.bodyTemplate}
              onChange={(e) => handleFieldChange("bodyTemplate", e.target.value)}
              placeholder="使用 {{变量}} 插入动态内容"
              rows={8}
              className="transition-all duration-200 hover:border-primary/50"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">可用变量</Label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <div
                  key={v.key}
                  className="flex items-stretch overflow-hidden rounded-lg border border-border/60 bg-card/50 transition-colors duration-200 hover:border-primary/40"
                >
                  <span
                    className="flex items-center bg-foreground/[0.04] px-2.5 font-mono text-xs text-foreground"
                    title={v.description}
                  >
                    {v.key}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => insertVariable(v.key, "title")}
                    title={`插入到标题：${v.description}`}
                    className="h-auto rounded-none border-l border-border/40 px-2 text-xs text-primary/80 hover:bg-primary/10 hover:text-primary"
                  >
                    标题
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => insertVariable(v.key, "body")}
                    title={`插入到正文：${v.description}`}
                    className="h-auto rounded-none border-l border-border/40 px-2 text-xs text-primary/80 hover:bg-primary/10 hover:text-primary"
                  >
                    正文
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">默认标签（逗号分隔）</Label>
            <Input
              value={form.defaultTags.join(", ")}
              onChange={(e) =>
                handleFieldChange(
                  "defaultTags",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
              placeholder="标签1, 标签2, 标签3"
              className="transition-all duration-200 hover:border-primary/50"
            />
            {form.defaultTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {form.defaultTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs font-normal">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Eye className="h-4 w-4 text-primary" />
            多平台预览
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className="gap-1.5"
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPreview ? "隐藏预览" : "显示预览"}
          </Button>
        </CardHeader>
        {showPreview && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">预览平台</Label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PLATFORM_ABBREVIATION).map(([key, label]) => {
                  const active = previewPlatforms.includes(key as SelfMediaPlatform);
                  return (
                    <Button
                      key={key}
                      variant={active ? "primary" : "outline"}
                      size="sm"
                      onClick={() => {
                        setPreviewPlatforms((prev) =>
                          prev.includes(key as SelfMediaPlatform)
                            ? prev.filter((p) => p !== key)
                            : [...prev, key as SelfMediaPlatform]
                        );
                      }}
                      className="gap-1.5"
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-4">
              {previewResults.map((preview) => (
                <PreviewCard key={preview.platform} preview={preview} />
              ))}
              {previewResults.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-6 text-center text-sm text-muted-foreground">
                  选择至少一个平台以预览效果
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function PreviewCard({ preview }: { preview: PlatformPreview }) {
  const hasForbidden = preview.forbiddenHits.length > 0;
  const overLimit = preview.charCount > preview.charLimit;

  return (
    <Card className="border-border/50 border-l-4 border-l-primary bg-background/40 transition-colors duration-200 hover:border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground">
          <Badge variant="outline" className="text-xs font-medium">{preview.platformName}</Badge>
          <span className={`text-xs font-medium tabular-nums ${overLimit ? "text-destructive" : "text-muted-foreground"}`}>
            {preview.charCount} / {preview.charLimit} 字符
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">标题</span>
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-foreground">{preview.title}</div>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">正文</span>
          <div className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-foreground">{preview.body}</div>
          {preview.wasTruncated && (
            <p className="text-xs text-muted-foreground/80">
              已按平台字数限制截断
            </p>
          )}
        </div>
        {hasForbidden && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              检测到禁用词：{preview.forbiddenHits.join("、")}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
