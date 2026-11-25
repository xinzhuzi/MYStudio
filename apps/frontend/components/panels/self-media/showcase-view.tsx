import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  buildShowcaseLinkUrl,
  escapeHtml,
  isSafeHttpUrl,
  renderDetailMarkdown,
  showcaseCtaText,
} from '@/lib/product/showcase';
import { useProductStore } from '@/stores/product/product-store';
import {
  useShowcaseConfigStore,
  type ShowcaseConfig,
  type ShowcaseSocialLink,
} from '@/stores/product/showcase-config-store';
import type { Product, ProductLink } from '@/types/product';

export type { ShowcaseConfig, ShowcaseSocialLink } from '@/stores/product/showcase-config-store';

export function ShowcaseView() {
  const products = useProductStore((s) => s.products);
  // A9:配置落持久化 store,面板切页签回来不丢
  const brandName = useShowcaseConfigStore((s) => s.brandName);
  const brandTagline = useShowcaseConfigStore((s) => s.brandTagline);
  const contactEmail = useShowcaseConfigStore((s) => s.contactEmail);
  const socialLinks = useShowcaseConfigStore((s) => s.socialLinks);
  const patchConfig = useShowcaseConfigStore((s) => s.patchConfig);
  const addSocialLink = useShowcaseConfigStore((s) => s.addSocialLink);
  const updateSocialLink = useShowcaseConfigStore((s) => s.updateSocialLink);
  const removeSocialLink = useShowcaseConfigStore((s) => s.removeSocialLink);
  const [previewMode, setPreviewMode] = useState(false);

  const config: ShowcaseConfig = { brandName, brandTagline, contactEmail, socialLinks };

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
          <h2 className="text-2xl font-bold tracking-tight text-foreground">产品展示页</h2>
          <p className="mt-1 text-sm text-foreground/80">
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
        <Card className="border-border/50 bg-card/80 shadow-sm">
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">品牌名称</label>
                <Input
                  value={config.brandName}
                  onChange={(e) => patchConfig({ brandName: e.target.value })}
                  placeholder="MYStudio"
                  className="transition-colors focus:border-primary/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">品牌标语</label>
                <Input
                  value={config.brandTagline}
                  onChange={(e) => patchConfig({ brandTagline: e.target.value })}
                  placeholder="创意工作室 · 数字产品集合"
                  className="transition-colors focus:border-primary/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">联系邮箱</label>
              <Input
                type="email"
                value={config.contactEmail}
                onChange={(e) => patchConfig({ contactEmail: e.target.value })}
                placeholder="contact@example.com"
                className="transition-colors focus:border-primary/50"
              />
            </div>
            {/* A10:社媒链接编辑 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">社媒链接</label>
                <Button type="button" variant="outline" size="sm" onClick={addSocialLink}>
                  <Plus className="h-4 w-4" />
                  添加
                </Button>
              </div>
              {socialLinks.length > 0 && (
                <div className="space-y-2">
                  {socialLinks.map((social, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={social.platform}
                        onChange={(e) => updateSocialLink(index, { platform: e.target.value })}
                        placeholder="平台名"
                        className="w-36 shrink-0 transition-colors focus:border-primary/50"
                      />
                      <Input
                        value={social.url}
                        onChange={(e) => updateSocialLink(index, { url: e.target.value })}
                        placeholder="https://example.com/mystudio"
                        className="flex-1 transition-colors focus:border-primary/50"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSocialLink(index)}
                        className="h-9 w-9 shrink-0 p-0 text-muted-foreground transition-colors hover:text-destructive"
                        aria-label={`删除社媒链接 ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {socialLinks.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  可添加小红书、X、B 站等主页链接,渲染在展示页底部
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 预览区 */}
      <Card className="overflow-hidden border-border/50 shadow-lg">
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
      <section className="border-b border-border/50 px-8 py-20 text-center">
        <h1 className="font-heading text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
          {config.brandName}
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">{config.brandTagline}</p>
      </section>

      {/* Products Grid */}
      <section className="px-8 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {products.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-border/60 bg-background/80 p-16 text-center">
              <p className="text-base font-medium text-muted-foreground">暂无产品</p>
              <p className="mt-2 text-sm text-muted-foreground">请先在产品目录中添加产品</p>
            </div>
          )}
        </div>
      </section>

      {/* Footer(A10:底部渲染社媒链接) */}
      <section className="border-t border-border/50 px-8 py-10 text-center text-sm text-muted-foreground">
        {config.socialLinks.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-center gap-4">
            {config.socialLinks.map((social, index) => (
              <SocialLinkItem key={index} social={social} />
            ))}
          </div>
        )}
        {config.contactEmail && <p className="mb-2">联系: {config.contactEmail}</p>}
        <p>© {new Date().getFullYear()} {config.brandName}</p>
      </section>
    </div>
  );
}

/** A10/A2:社媒链接只放行 http/https,其余降级为纯文本。 */
function SocialLinkItem({ social }: { social: ShowcaseSocialLink }) {
  const label = social.platform || social.url;
  if (!isSafeHttpUrl(social.url)) {
    return <span className="text-muted-foreground">{label}</span>;
  }
  return (
    <a
      href={social.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary transition-colors hover:text-primary/80"
    >
      {label}
    </a>
  );
}

/** A11:应用内 detail 的 Markdown 渲染,范式同 components/panels/media/RefPreview.tsx。 */
const DETAIL_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-2 text-base font-semibold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 text-sm font-semibold text-foreground">{children}</h3>,
  p: ({ children }) => <p className="mb-2 text-muted-foreground last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
  pre: ({ children }) => <pre className="mb-2 overflow-auto rounded bg-muted p-2 text-xs">{children}</pre>,
};

function ProductCard({ product }: { product: Product }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const hasDetail = product.detail.trim().length > 0;
  // A2:封面地址只放行 http/https,否则跳过整个 img
  const showCover = product.coverImage !== '' && isSafeHttpUrl(product.coverImage);
  return (
    <Card className="group overflow-hidden border-border/50 bg-card shadow-sm transition-all duration-300 hover:border-primary/30 hover:shadow-xl">
      {showCover && (
        <div className="aspect-video overflow-hidden bg-muted/80">
          <img
            src={product.coverImage}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        </div>
      )}
      <CardContent className="space-y-4 p-6">
        <h3 className="font-heading text-xl font-semibold text-foreground">{product.name}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">{product.description}</p>
        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {product.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {/* A11:详细描述展开/收起 */}
        {hasDetail && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setDetailOpen(!detailOpen)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              {detailOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {detailOpen ? '收起' : '展开'}
            </button>
            {detailOpen && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm leading-7">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={DETAIL_MARKDOWN_COMPONENTS}>
                  {product.detail}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
        {product.links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {product.links.map((link, idx) => (
              <ShowcaseLinkItem key={idx} link={link} product={product} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A4/A2:按钮文字与 UTM 都走 lib/product/showcase 的同一函数;非 http(s) 降级纯文本。 */
function ShowcaseLinkItem({ link, product }: { link: ProductLink; product: Product }) {
  const label = showcaseCtaText(link.label, product.promotion.ctaType);
  const safeHref = isSafeHttpUrl(link.url) ? buildShowcaseLinkUrl(link.url, product) : null;
  if (!safeHref) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

/**
 * 序列化成可以安全内嵌进 <script type="application/json"> 的 JSON 文本。
 * 数据里出现 `</script>` 或 `<!--` 会让脚本块提前结束，后面的内容被当成可执行脚本，
 * 所以把所有 `<` 写成 \u003c；U+2028、U+2029 写成转义写法。
 * 这些转义只在 JSON 字符串内部出现，JSON.parse 读回的值与原值相同。
 */
function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * A3:导出页零外部请求——原先的 Google Fonts 两条 preconnect+css 与 Tailwind CDN
 * script+config 块全部删除,换这段内联手写 CSS(系统字体栈 + hero/网格卡片/pill/
 * footer 类)。断网双击打开样式完整;1/2/3 列断点与旧观感对齐,hover 动效简化为静态阴影。
 */
const SHOWCASE_EXPORT_CSS = `
:root{--ink:#171717;--muted:#525252;--faint:#a3a3a3;--line:#e5e5e5;--card:#ffffff;--page:#fafafa;--field:#f5f5f5;--accent:#2563eb;--accent-soft:#eff6ff}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:var(--page);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased}
h1,h2,h3,p,ul,ol{margin:0}
.showcase-hero{border-bottom:1px solid var(--line);padding:80px 32px;text-align:center}
.showcase-hero h1{font-size:clamp(2.5rem,6vw,3.75rem);font-weight:700;letter-spacing:-.025em;line-height:1.1}
.showcase-hero p{margin-top:24px;font-size:1.125rem;color:var(--muted)}
.showcase-main{padding:64px 32px}
.showcase-grid{max-width:72rem;margin:0 auto;display:grid;gap:24px;grid-template-columns:1fr}
@media (min-width:640px){.showcase-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1024px){.showcase-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.showcase-card{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;flex-direction:column}
.showcase-card-img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--field)}
.showcase-card-body{display:flex;flex-direction:column;gap:16px;padding:24px;flex:1}
.showcase-card-body h3{font-size:1.25rem;font-weight:600;line-height:1.3}
.showcase-card-desc{font-size:.875rem;line-height:1.625;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.showcase-tags{display:flex;flex-wrap:wrap;gap:6px}
.showcase-pill{display:inline-block;padding:4px 12px;border-radius:9999px;background:var(--accent-soft);color:var(--accent);font-size:.75rem;font-weight:500;line-height:1.4}
.showcase-detail summary{cursor:pointer;user-select:none;list-style:none;display:inline-flex;align-items:center;gap:4px;font-size:.75rem;font-weight:500;color:var(--accent)}
.showcase-detail summary::-webkit-details-marker{display:none}
.showcase-detail summary::before{content:"展开"}
.showcase-detail[open] summary::before{content:"收起"}
.showcase-detail summary::after{content:"+";font-weight:600}
.showcase-detail[open] summary::after{content:"\\2212"}
.showcase-detail-body{margin-top:12px;font-size:.875rem;color:var(--muted);line-height:1.7}
.showcase-detail-body h1{font-size:1.125rem;font-weight:600;color:var(--ink);margin:0 0 8px}
.showcase-detail-body h2{font-size:1rem;font-weight:600;color:var(--ink);margin:0 0 8px}
.showcase-detail-body h3{font-size:.9375rem;font-weight:600;color:var(--ink);margin:0 0 6px}
.showcase-detail-body p{margin:0 0 10px}
.showcase-detail-body ul{margin:0 0 10px;padding-left:1.25rem;list-style:disc}
.showcase-detail-body li{margin:2px 0}
.showcase-detail-body code{background:var(--field);border-radius:4px;padding:1px 5px;font-size:.85em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.showcase-links{display:flex;flex-wrap:wrap;gap:8px;padding-top:8px;margin-top:auto}
.showcase-cta{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;background:var(--accent-soft);color:var(--accent);font-size:.875rem;font-weight:500;text-decoration:none}
.showcase-cta svg{width:14px;height:14px}
.showcase-cta-static{background:var(--field);color:var(--muted)}
.showcase-empty{grid-column:1/-1;border:2px dashed #d4d4d4;border-radius:12px;background:rgba(250,250,250,.5);padding:64px 32px;text-align:center}
.showcase-empty-title{font-size:1rem;font-weight:500;color:var(--muted)}
.showcase-empty-sub{margin-top:8px;font-size:.875rem;color:var(--faint)}
.showcase-footer{border-top:1px solid var(--line);padding:40px 32px;text-align:center;font-size:.875rem;color:var(--muted)}
.showcase-social{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;margin:0 0 12px}
.showcase-social a{color:var(--accent);text-decoration:none}
.showcase-social span{color:var(--muted)}
.showcase-footer-contact{margin:0 0 8px}
`;

/** A2:非 http(s) 的产品链接不输出 href,降级为纯文本 CTA。 */
function showcaseCtaHtml(link: ProductLink, product: Product): string {
  const label = escapeHtml(showcaseCtaText(link.label, product.promotion.ctaType));
  if (!isSafeHttpUrl(link.url)) {
    return `<span class="showcase-cta showcase-cta-static">${label}</span>`;
  }
  // A4:UTM 追加与应用内预览共用 buildShowcaseLinkUrl,两处输出一致
  const href = escapeHtml(buildShowcaseLinkUrl(link.url, product));
  return `<a class="showcase-cta" href="${href}" target="_blank" rel="noopener noreferrer">${label}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>`;
}

/** A11:导出页 detail 用迷你 Markdown 渲染(内部先转义后变换),零 JS 的 details 展开。 */
function showcaseDetailHtml(product: Product): string {
  if (!product.detail.trim()) return '';
  const body = renderDetailMarkdown(product.detail);
  return `<details class="showcase-detail"><summary></summary><div class="showcase-detail-body">${body}</div></details>`;
}

function showcaseCardHtml(product: Product): string {
  const coverHtml =
    product.coverImage !== '' && isSafeHttpUrl(product.coverImage)
      ? `<img class="showcase-card-img" src="${escapeHtml(product.coverImage)}" alt="${escapeHtml(product.name)}">`
      : '';
  const tagsHtml =
    product.tags.length > 0
      ? `<div class="showcase-tags">${product.tags
          .slice(0, 3)
          .map((tag) => `<span class="showcase-pill">${escapeHtml(tag)}</span>`)
          .join('')}</div>`
      : '';
  const linksHtml =
    product.links.length > 0
      ? `<div class="showcase-links">${product.links.map((link) => showcaseCtaHtml(link, product)).join('')}</div>`
      : '';
  return `<article class="showcase-card">${coverHtml}<div class="showcase-card-body"><h3>${escapeHtml(product.name)}</h3><p class="showcase-card-desc">${escapeHtml(product.description)}</p>${tagsHtml}${showcaseDetailHtml(product)}${linksHtml}</div></article>`;
}

/** A10:导出页底部渲染社媒链接,URL 过 A2 的 http(s) 安全规则。 */
function showcaseFooterHtml(config: ShowcaseConfig): string {
  const socialHtml =
    config.socialLinks.length > 0
      ? `<div class="showcase-social">${config.socialLinks
          .map((social) => {
            const label = escapeHtml(social.platform || social.url);
            return isSafeHttpUrl(social.url)
              ? `<a href="${escapeHtml(social.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
              : `<span>${label}</span>`;
          })
          .join('')}</div>`
      : '';
  const contactHtml = config.contactEmail
    ? `<p class="showcase-footer-contact">联系: ${escapeHtml(config.contactEmail)}</p>`
    : '';
  return `<footer class="showcase-footer">${socialHtml}${contactHtml}<p>© ${new Date().getFullYear()} ${escapeHtml(config.brandName)}</p></footer>`;
}

/**
 * 生成自包含静态 HTML(A3):全部正文在生成期由 TS 渲染完成——品牌名、产品数据等
 * 一律先过 escapeHtml 再插值(文本位与属性位),Markdown 走 renderDetailMarkdown
 * (内部先转义后变换),地址类只放行 http/https。页面零外部请求、零运行时脚本,
 * 断网双击即可打开。两个 JSON 数据块保留为数据契约载体(往返一致性由测试锁住)。
 */
export function generateShowcaseHTML(products: Product[], config: ShowcaseConfig): string {
  const productsJSON = serializeJsonForScript(products);
  const configJSON = serializeJsonForScript(config);
  const cardsHtml =
    products.length > 0
      ? products.map(showcaseCardHtml).join('\n')
      : '<article class="showcase-empty"><p class="showcase-empty-title">暂无产品</p><p class="showcase-empty-sub">请先在产品目录中添加产品</p></article>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.brandName)} - 产品展示</title>
  <meta name="description" content="${escapeHtml(config.brandTagline)}">
  <style>${SHOWCASE_EXPORT_CSS}</style>
</head>
<body>
  <header class="showcase-hero">
    <h1>${escapeHtml(config.brandName)}</h1>
    <p>${escapeHtml(config.brandTagline)}</p>
  </header>
  <main class="showcase-main">
    <div class="showcase-grid">${cardsHtml}</div>
  </main>
  ${showcaseFooterHtml(config)}
  <script type="application/json" id="products-data">${productsJSON}</script>
  <script type="application/json" id="config-data">${configJSON}</script>
</body>
</html>`;
}
