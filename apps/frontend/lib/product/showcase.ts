/**
 * 展示页(A2/A3/A4/A10/A11 补检条目)共用的纯函数层。
 * 应用内预览与导出 HTML 都从这里取函数,保证两处渲染一致(A4 的硬要求)。
 * 全部为纯函数:不碰 React、不碰 store、不碰 DOM。
 */
import type { Product, ProductCtaType } from "@/types/product";

/** HTML 实体的五个字符。& 必须最先替换,否则会把后面生成的实体二次转义。 */
const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * A2:文本位与属性位统一的 HTML 转义。任何插进导出 HTML 的字符串
 * (品牌名、标语、邮箱、产品名/描述/标签、链接文字,以及 href/src 属性值)
 * 都必须先过这里;先转义,后做其他变换(见 renderDetailMarkdown)。
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ENTITY_MAP[char] ?? char);
}

/**
 * A2:地址类(href/src)只放行 http/https。解析失败、相对地址、
 * javascript:/data:/file: 等一律判不安全,调用方据此降级(去 href、跳过 img)。
 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** A4:CTA 措辞与产品表单「CTA 类型」下拉同名;未知值兜底「查看」。 */
const CTA_LABELS: Record<ProductCtaType, string> = {
  access: "接入",
  read: "阅读",
  download: "下载",
  learn_more: "了解更多",
  community: "加入社区",
};

export function ctaLabelFor(ctaType: ProductCtaType | string): string {
  return (CTA_LABELS as Record<string, string>)[ctaType] ?? "查看";
}

/**
 * A4:CTA 按钮文字=链接的「按钮文字」,留空回落到 CTA 类型的措辞。
 * 预览卡片与导出页共用,替代原「导出页 getCTALabel 定义了从未调用」的死代码。
 */
export function showcaseCtaText(linkLabel: string, ctaType: ProductCtaType): string {
  return linkLabel || ctaLabelFor(ctaType);
}

/**
 * A4:展示页链接统一走这里——http(s) 才追加 UTM 三件套
 * (utm_source=showcase / utm_medium=referral / utm_campaign=<推广配置或 slug>),
 * 地址里已有的同名 utm_* 参数不覆盖;非法 URL 原样返回。
 * 应用内预览与导出页必须同时调用本函数(A4 的硬要求)。
 */
export function buildShowcaseLinkUrl(
  linkUrl: string,
  product: Pick<Product, "slug" | "promotion">,
): string {
  let parsed: URL;
  try {
    parsed = new URL(linkUrl);
  } catch {
    return linkUrl;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return linkUrl;
  const campaign = product.promotion.utm.campaign || product.slug;
  if (!parsed.searchParams.has("utm_source")) parsed.searchParams.set("utm_source", "showcase");
  if (!parsed.searchParams.has("utm_medium")) parsed.searchParams.set("utm_medium", "referral");
  if (!parsed.searchParams.has("utm_campaign")) parsed.searchParams.set("utm_campaign", campaign);
  return parsed.toString();
}

/** 行内变换:对已转义文本处理 `码`、**粗**、*斜*。码段内容不再做粗斜变换。 */
function renderInlineMarkdown(escapedText: string): string {
  const segments = escapedText.split(/`([^`]*)`/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return `<code>${segment}</code>`;
      return segment
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    })
    .join("");
}

/**
 * A11:导出页的迷你 Markdown→HTML。输入视为未转义原文:
 * 内部先逐行 escapeHtml,再按块结构变换(转义不改动 *、`、#、- 等标记字符,
 * 所以「先转义后变换」的次序由实现保证,调用方不会忘)。
 * 支持:空行分段、#/##/### 标题、- 列表、**粗**、*斜*、`码`。
 */
export function renderDetailMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map(escapeHtml);
  const blocks: string[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join("\n"))}</p>`);
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") {
      // 空行分段:同时结束段落与列表
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]!)}</h${level}>`);
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}
