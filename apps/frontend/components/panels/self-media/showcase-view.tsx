import { useState } from 'react';
import { Download, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useProductStore } from '@/stores/product/product-store';
import type { Product } from '@/types/product';

interface ShowcaseConfig {
  brandName: string;
  brandTagline: string;
  contactEmail: string;
  socialLinks: { platform: string; url: string }[];
}

const DEFAULT_CONFIG: ShowcaseConfig = {
  brandName: 'MYStudio',
  brandTagline: '创意工作室 · 数字产品集合',
  contactEmail: '',
  socialLinks: [],
};

export function ShowcaseView() {
  const products = useProductStore((s) => s.products);
  const [config, setConfig] = useState<ShowcaseConfig>(DEFAULT_CONFIG);
  const [previewMode, setPreviewMode] = useState(false);

  const handleExportHTML = async () => {
    const html = generateShowcaseHTML(products, config);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'showcase.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 控制面板 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">产品展示页</h2>
          <p className="text-sm text-muted-foreground">
            配置并导出自包含的 HTML 展示页
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewMode(!previewMode)}
          >
            {previewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {previewMode ? '编辑模式' : '预览模式'}
          </Button>
          <Button size="sm" onClick={handleExportHTML}>
            <Download className="h-4 w-4" />
            导出 HTML
          </Button>
        </div>
      </div>

      {/* 配置区 */}
      {!previewMode && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">品牌名称</label>
                <Input
                  value={config.brandName}
                  onChange={(e) => setConfig({ ...config, brandName: e.target.value })}
                  placeholder="MYStudio"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">品牌标语</label>
                <Input
                  value={config.brandTagline}
                  onChange={(e) => setConfig({ ...config, brandTagline: e.target.value })}
                  placeholder="创意工作室 · 数字产品集合"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">联系邮箱</label>
              <Input
                type="email"
                value={config.contactEmail}
                onChange={(e) => setConfig({ ...config, contactEmail: e.target.value })}
                placeholder="contact@example.com"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* 预览区 */}
      <Card>
        <CardContent className="p-0">
          <ShowcasePreview products={products} config={config} />
        </CardContent>
      </Card>
    </div>
  );
}

function ShowcasePreview({ products, config }: { products: Product[]; config: ShowcaseConfig }) {
  return (
    <div className="bg-background">
      {/* Hero Section */}
      <section className="border-b border-border px-8 py-16 text-center">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
          {config.brandName}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{config.brandTagline}</p>
      </section>

      {/* Products Grid */}
      <section className="px-8 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {products.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              暂无产品，请先在产品目录中添加产品
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <section className="border-t border-border px-8 py-8 text-center text-sm text-muted-foreground">
        {config.contactEmail && <p>联系: {config.contactEmail}</p>}
        <p className="mt-2">© {new Date().getFullYear()} {config.brandName}</p>
      </section>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Card className="group overflow-hidden border-border transition-all hover:border-primary/50 hover:shadow-lg">
      {product.coverImage && (
        <div className="aspect-video overflow-hidden bg-muted">
          <img
            src={product.coverImage}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}
      <CardContent className="space-y-3 p-6">
        <h3 className="font-heading text-xl font-semibold">{product.name}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{product.description}</p>
        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {product.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {product.links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {product.links.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function generateShowcaseHTML(products: Product[], config: ShowcaseConfig): string {
  const productsJSON = JSON.stringify(products, null, 2);
  const configJSON = JSON.stringify(config, null, 2);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.brandName} - 产品展示</title>
  <meta name="description" content="${config.brandTagline}">
  
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            heading: ['Space Grotesk', 'sans-serif'],
            body: ['Archivo', 'sans-serif'],
          },
        },
      },
    }
  </script>
  
  <style>
    body { font-family: 'Archivo', sans-serif; }
    .font-heading { font-family: 'Space Grotesk', sans-serif; }
  </style>
</head>
<body class="bg-neutral-50 text-neutral-900">
  <div id="root"></div>
  
  <script type="application/json" id="products-data">${productsJSON}</script>
  <script type="application/json" id="config-data">${configJSON}</script>
  
  <script>
    const products = JSON.parse(document.getElementById('products-data').textContent);
    const config = JSON.parse(document.getElementById('config-data').textContent);
    
    function getCTALabel(ctaType) {
      const labels = {
        access: '访问',
        read: '阅读',
        download: '下载',
        learn_more: '了解更多',
        community: '加入社区',
      };
      return labels[ctaType] || '查看';
    }
    
    function renderShowcase() {
      const root = document.getElementById('root');
      
      const heroHTML = \`
        <section class="border-b border-neutral-200 px-8 py-16 text-center">
          <h1 class="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
            \${config.brandName}
          </h1>
          <p class="mt-4 text-lg text-neutral-600">\${config.brandTagline}</p>
        </section>
      \`;
      
      const productsHTML = products.length > 0 ? products.map(product => \`
        <div class="group overflow-hidden rounded-lg border border-neutral-200 bg-white transition-all hover:border-blue-500/50 hover:shadow-lg">
          \${product.coverImage ? \`
            <div class="aspect-video overflow-hidden bg-neutral-100">
              <img src="\${product.coverImage}" alt="\${product.name}" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105">
            </div>
          \` : ''}
          <div class="space-y-3 p-6">
            <h3 class="font-heading text-xl font-semibold">\${product.name}</h3>
            <p class="text-sm text-neutral-600 line-clamp-2">\${product.description}</p>
            \${product.tags.length > 0 ? \`
              <div class="flex flex-wrap gap-1">
                \${product.tags.slice(0, 3).map(tag => \`
                  <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">\${tag}</span>
                \`).join('')}
              </div>
            \` : ''}
            \${product.links.length > 0 ? \`
              <div class="flex flex-wrap gap-2 pt-2">
                \${product.links.map(link => \`
                  <a href="\${link.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
                    \${link.label}
                    <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                  </a>
                \`).join('')}
              </div>
            \` : ''}
          </div>
        </div>
      \`).join('') : '<div class="col-span-full rounded-lg border border-dashed border-neutral-300 p-12 text-center text-neutral-500">暂无产品</div>';
      
      const productsSectionHTML = \`
        <section class="px-8 py-12">
          <div class="mx-auto max-w-6xl">
            <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              \${productsHTML}
            </div>
          </div>
        </section>
      \`;
      
      const footerHTML = \`
        <section class="border-t border-neutral-200 px-8 py-8 text-center text-sm text-neutral-600">
          \${config.contactEmail ? \`<p>联系: \${config.contactEmail}</p>\` : ''}
          <p class="mt-2">© \${new Date().getFullYear()} \${config.brandName}</p>
        </section>
      \`;
      
      root.innerHTML = heroHTML + productsSectionHTML + footerHTML;
    }
    
    renderShowcase();
  </script>
</body>
</html>`;
}
