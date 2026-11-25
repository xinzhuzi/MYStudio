import { useCallback, useEffect, useState } from "react";
import {
  Box,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProductStore } from "@/stores/product/product-store";
import type { Product, ProductLink, ProductCtaType } from "@/types/product";
import { getProductBridge } from "./view-helpers";

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

export function ProductsView() {
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
          <Button size="sm" onClick={() => setEditingProduct(createEmptyProduct())}>
            <Plus className="h-4 w-4" />
            新增
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-background/80 px-6 py-12 text-center">
            <Box className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">暂无产品</p>
            <p className="mt-1 text-xs text-muted-foreground/80">点击「新增」按钮创建第一个产品</p>
          </div>
        ) : (
          products.map((product) => (
            <Card key={product.id} className="group border-border/50 bg-card/80 transition-all duration-200 hover:border-border/70 hover:bg-card/90">
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
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
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

  // A5(1125 补检): 品牌约束录入——语气关键词/禁用词按逗号分隔(保留含空格的短语)
  function updateBrandProfile(key: "tone" | "forbiddenWords", value: string) {
    updateField("brandProfile", {
      ...form.brandProfile,
      [key]: value.split(/[,，]/).map((word) => word.trim()).filter(Boolean),
    });
  }

  return (
    <Card className="border-border/50 bg-card/80">
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
        <div className="space-y-3 rounded-lg border border-border/40 bg-background/80 p-4">
          <span className="text-sm font-semibold text-foreground">CTA 链接</span>
          <div className="space-y-2">
            {form.links.map((link, index) => (
              <div 
                key={index} 
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5 transition-all duration-200 hover:border-border/70 hover:bg-background/90"
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
              placeholder="留空按 CTA 类型显示"
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
        <div className="space-y-3 rounded-lg border border-border/40 bg-background/80 p-4">
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
        {/* A5(1125 补检): 品牌约束——模板页的品牌展示与发布页禁用词检查都读这两个字段 */}
        <div className="space-y-3 rounded-lg border border-border/40 bg-background/80 p-4">
          <span className="text-sm font-semibold text-foreground">品牌约束</span>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">语气关键词</span>
              <Input
                value={form.brandProfile.tone.join(", ")}
                onChange={(e) => updateBrandProfile("tone", e.target.value)}
                placeholder="用逗号分隔，例如：专业, 活泼"
                className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">禁用词</span>
              <Input
                value={form.brandProfile.forbiddenWords.join(", ")}
                onChange={(e) => updateBrandProfile("forbiddenWords", e.target.value)}
                placeholder="用逗号分隔，例如：最便宜, 保证有效"
                className="transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
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
