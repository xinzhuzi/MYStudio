/**
 * B5 模板渲染引擎——简单字符串替换 + 风控集成。
 *
 * 支持的模板变量(design.md §B5):
 *   {{product.name}}  {{product.description}}  {{product.link}}
 *   {{date}}  {{platform}}
 *
 * 风控集成:
 *   - 渲染时自动注入 {{platform}} 变量,替代 B1a 最小差异化(§B5 风控集成)
 *   - 禁用词检查:正文中出现 brandProfile.forbiddenWords 时标红提示
 *   - 平台字数裁剪:按 capabilities.ts 的 PLATFORM_CHAR_LIMITS 截断
 */
import type { SelfMediaPlatform } from "@/types/self-media";
import type {
  PromotionTemplate,
  TemplateContext,
  TemplateRenderResult,
} from "@/types/promotion-template";
import type { ProductBrandProfile } from "@/types/product";
import { PLATFORM_CHAR_LIMITS, PLATFORM_ABBREVIATION } from "./batch-publish";

// ─── Variable interpolation ───────────────────────────────────────────────────

/**
 * Replace all `{{key}}` placeholders in a template string with values from context.
 * Supports nested keys like `product.name`.
 */
export function interpolateTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_match, key: string) => {
    const parts = key.split(".");
    let value: unknown = context;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return "";
      value = (value as Record<string, unknown>)[part];
    }
    return typeof value === "string" ? value : "";
  });
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Build a TemplateContext from product info and target platform.
 * `product.link` picks the first CTA link URL, or empty string if none.
 */
export function buildTemplateContext(params: {
  productName: string;
  productDescription: string;
  productLink?: string;
  platform: SelfMediaPlatform;
}): TemplateContext {
  return {
    product: {
      name: params.productName,
      description: params.productDescription,
      link: params.productLink ?? "",
    },
    date: new Date().toLocaleDateString("zh-CN"),
    platform: PLATFORM_ABBREVIATION[params.platform],
  };
}

// ─── Forbidden words checker ──────────────────────────────────────────────────

/**
 * Scan text for forbidden words from brandProfile.
 * Returns the list of matched forbidden words (each reported once).
 */
export function checkForbiddenWords(text: string, forbiddenWords: string[]): string[] {
  if (forbiddenWords.length === 0) return [];
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const word of forbiddenWords) {
    if (word && lower.includes(word.toLowerCase())) {
      hits.push(word);
    }
  }
  return hits;
}

// ─── Platform text trimming ───────────────────────────────────────────────────

/**
 * Trim body text to fit within a platform's character limit.
 * Returns `{ trimmed, wasTruncated }`.
 */
export function trimForPlatform(text: string, platform: SelfMediaPlatform): { trimmed: string; wasTruncated: boolean } {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  if (text.length <= limit) return { trimmed: text, wasTruncated: false };
  return { trimmed: `${text.slice(0, limit - 1)}…`, wasTruncated: true };
}

// ─── Full render pipeline ─────────────────────────────────────────────────────

/**
 * Render a PromotionTemplate with the given product data and platform.
 * Returns title, body, tags, forbidden-word hits, and platform-trimmed body.
 *
 * Per design.md §B5:
 *   "模板自动注入 {{platform}} 变量,确保各平台文案不完全相同(替代 B1a 的最小差异化机制)"
 *   "禁用词检查:正文中出现 brandProfile.forbiddenWords 时标红提示"
 *   "模板预览界面显示各平台字数裁剪效果"
 */
export function renderTemplate(params: {
  template: PromotionTemplate;
  productName: string;
  productDescription: string;
  productLink?: string;
  brandProfile?: ProductBrandProfile;
}): TemplateRenderResult {
  const { template, productName, productDescription, productLink, brandProfile } = params;

  const context = buildTemplateContext({
    productName,
    productDescription,
    productLink,
    platform: template.platform,
  });

  const title = interpolateTemplate(template.titleTemplate, context);
  const body = interpolateTemplate(template.bodyTemplate, context);
  const tags = [...template.defaultTags];

  // Forbidden words check on title + body combined
  const forbiddenWords = brandProfile?.forbiddenWords ?? [];
  const forbiddenHits = checkForbiddenWords(`${title}\n${body}`, forbiddenWords);

  // Platform character trimming
  const { trimmed: trimmedBody, wasTruncated } = trimForPlatform(body, template.platform);

  return {
    title,
    body,
    tags,
    forbiddenHits,
    trimmedBody,
    wasTruncated,
  };
}

// ─── Multi-platform preview ───────────────────────────────────────────────────

export interface PlatformPreview {
  platform: SelfMediaPlatform;
  platformName: string;
  title: string;
  body: string;
  trimmedBody: string;
  wasTruncated: boolean;
  forbiddenHits: string[];
  charCount: number;
  charLimit: number;
}

/**
 * Render the same template content for multiple platforms, producing previews.
 * Useful for the template preview UI that shows "各平台字数裁剪效果".
 */
export function renderMultiPlatformPreview(params: {
  template: PromotionTemplate;
  productName: string;
  productDescription: string;
  productLink?: string;
  brandProfile?: ProductBrandProfile;
  targetPlatforms: SelfMediaPlatform[];
}): PlatformPreview[] {
  const { template, productName, productDescription, productLink, brandProfile, targetPlatforms } = params;

  return targetPlatforms.map((platform) => {
    // Override the template's platform for preview purposes
    const previewTemplate = { ...template, platform };
    const result = renderTemplate({
      template: previewTemplate,
      productName,
      productDescription,
      productLink,
      brandProfile,
    });

    return {
      platform,
      platformName: PLATFORM_ABBREVIATION[platform],
      title: result.title,
      body: result.body,
      trimmedBody: result.trimmedBody,
      wasTruncated: result.wasTruncated,
      forbiddenHits: result.forbiddenHits,
      charCount: result.body.length,
      charLimit: PLATFORM_CHAR_LIMITS[platform],
    };
  });
}
