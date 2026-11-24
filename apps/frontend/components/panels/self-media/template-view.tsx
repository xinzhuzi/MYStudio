import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Plus, Pencil, Trash2, AlertTriangle, Eye } from "lucide-react";
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
  { key: "{{platform}}", description: "平台名称(自动注入)" },
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
    const confirmed = window.confirm("确定要删除这个模板吗?");
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">推广模板</h2>
          <p className="text-sm text-muted-foreground">
            创建可复用的内容模板,自动适配不同平台并执行风控检查
          </p>
        </div>
        <Button onClick={handleCreateNew} disabled={products.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          新建模板
        </Button>
      </div>

      {products.length === 0 ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            请先在"产品"标签中创建至少一个产品,然后才能创建推广模板。
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Select value={selectedProductFilter} onValueChange={setSelectedProductFilter}>
            <SelectTrigger className="w-64">
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

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              暂无模板,点击"新建模板"开始创建
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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{template.name}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{productName}</Badge>
              <Badge variant="outline">{platformLabel}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 h-3 w-3" />
              编辑
            </Button>
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1 h-3 w-3" />
              删除
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">标题模板:</span>
            <span className="ml-2 text-muted-foreground">{template.titleTemplate || "(空)"}</span>
          </div>
          <div>
            <span className="font-medium">正文模板:</span>
            <span className="ml-2 text-muted-foreground line-clamp-2">{template.bodyTemplate || "(空)"}</span>
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
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{template.id ? "编辑模板" : "新建模板"}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleSubmit}>保存</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>模板名称</Label>
              <Input
                value={form.name}
                onChange={(e) => handleFieldChange("name", e.target.value)}
                placeholder="例如:小红书种草模板"
              />
            </div>
            <div>
              <Label>关联产品</Label>
              <Select
                value={form.productId}
                onValueChange={(v) => handleFieldChange("productId", v)}
              >
                <SelectTrigger>
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
            <div>
              <Label>目标平台</Label>
              <Select
                value={form.platform}
                onValueChange={(v) => handleFieldChange("platform", v as SelfMediaPlatform)}
              >
                <SelectTrigger>
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
            <div>
              <Label>媒体槽位数量</Label>
              <Input
                type="number"
                min="0"
                max="20"
                value={form.mediaSlots}
                onChange={(e) => handleFieldChange("mediaSlots", parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {brandProfile && (brandProfile.tone.length > 0 || brandProfile.forbiddenWords.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              品牌约束
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {brandProfile.tone.length > 0 && (
              <div>
                <Label className="text-sm font-medium">语气关键词</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {brandProfile.tone.map((word) => (
                    <Badge key={word} variant="secondary">
                      {word}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {brandProfile.forbiddenWords.length > 0 && (
              <div>
                <Label className="text-sm font-medium">禁用词</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {brandProfile.forbiddenWords.map((word) => (
                    <Badge key={word} variant="destructive">
                      {word}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>模板内容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>标题模板</Label>
            <Textarea
              value={form.titleTemplate}
              onChange={(e) => handleFieldChange("titleTemplate", e.target.value)}
              placeholder="使用 {{变量}} 插入动态内容,例如:{{product.name}} - {{date}}"
              rows={2}
            />
          </div>
          <div>
            <Label>正文模板</Label>
            <Textarea
              value={form.bodyTemplate}
              onChange={(e) => handleFieldChange("bodyTemplate", e.target.value)}
              placeholder="使用 {{变量}} 插入动态内容"
              rows={8}
            />
          </div>
          <div>
            <Label>可用变量 (点击插入)</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <div key={v.key} className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable(v.key, "title")}
                    className="text-xs"
                  >
                    {v.key} → 标题
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable(v.key, "body")}
                    className="text-xs"
                  >
                    {v.key} → 正文
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {`{{platform}}`} 变量会自动注入平台名称,实现内容差异化
            </p>
          </div>
          <div>
            <Label>默认标签 (逗号分隔)</Label>
            <Input
              value={form.defaultTags.join(", ")}
              onChange={(e) =>
                handleFieldChange(
                  "defaultTags",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
              placeholder="标签1, 标签2, 标签3"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            多平台预览
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? "隐藏预览" : "显示预览"}
          </Button>
        </CardHeader>
        {showPreview && (
          <CardContent className="space-y-4">
            <div>
              <Label>预览平台</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(PLATFORM_ABBREVIATION).map(([key, label]) => (
                  <Button
                    key={key}
                    variant={previewPlatforms.includes(key as SelfMediaPlatform) ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setPreviewPlatforms((prev) =>
                        prev.includes(key as SelfMediaPlatform)
                          ? prev.filter((p) => p !== key)
                          : [...prev, key as SelfMediaPlatform]
                      );
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              {previewResults.map((preview) => (
                <PreviewCard key={preview.platform} preview={preview} />
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function PreviewCard({ preview }: { preview: PlatformPreview }) {
  const hasForbidden = preview.forbiddenHits.length > 0;
  const charColor = preview.charCount > preview.charLimit ? "text-destructive" : "text-muted-foreground";

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>{preview.platformName}</span>
          <span className={`text-sm font-normal ${charColor}`}>
            {preview.charCount} / {preview.charLimit} 字符
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="font-medium">标题:</span>
          <div className="mt-1 p-2 bg-muted rounded">{preview.title}</div>
        </div>
        <div>
          <span className="font-medium">正文:</span>
          <div className="mt-1 p-2 bg-muted rounded whitespace-pre-wrap">{preview.body}</div>
          {preview.wasTruncated && (
            <p className="text-xs text-muted-foreground mt-1">
              (已截断以适应平台字数限制)
            </p>
          )}
        </div>
        {hasForbidden && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              检测到禁用词: {preview.forbiddenHits.join(", ")}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
