import { describe, expect, it } from "vitest";
import {
  buildTemplateContext,
  buildTemplateFill,
  checkForbiddenWords,
  interpolateTemplate,
  mergeTopicStrings,
  renderMultiPlatformPreview,
  renderTemplate,
  trimForPlatform,
} from "./template-engine";
import type { PromotionTemplate } from "@/types/promotion-template";
import type { SelfMediaPlatform } from "@/types/self-media";

function template(overrides: Partial<PromotionTemplate> = {}): PromotionTemplate {
  return {
    id: "tpl-1",
    productId: "product-1",
    name: "通用推广模板",
    platform: "xhs",
    titleTemplate: "{{product.name}} 上线啦",
    bodyTemplate: "{{product.description}}\n立即体验:{{product.link}}\n{{date}} · {{platform}} 独家",
    defaultTags: ["漫剧", "剧情解说"],
    mediaSlots: 3,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("interpolateTemplate", () => {
  const context = {
    product: { name: "星河漫剧", description: "每周三更新", link: "https://example.com" },
    date: "2026/11/25",
    platform: "小红书",
  };

  it("renders nested and top-level variables", () => {
    expect(interpolateTemplate("{{product.name}}", context)).toBe("星河漫剧");
    expect(interpolateTemplate("{{product.link}}", context)).toBe("https://example.com");
    expect(interpolateTemplate("{{date}}", context)).toBe("2026/11/25");
    expect(interpolateTemplate("{{platform}}", context)).toBe("小红书");
    expect(interpolateTemplate("{{product.name}} on {{platform}}", context)).toBe("星河漫剧 on 小红书");
  });

  it("falls back to an empty string for missing params (缺参回退)", () => {
    expect(interpolateTemplate("{{product.missing}}", context)).toBe("");
    expect(interpolateTemplate("{{unknown}}", context)).toBe("");
  });

  it("drops non-string variable values instead of stringifying them", () => {
    const numericName = { ...context, product: { ...context.product, name: 42 as unknown as string } };
    expect(interpolateTemplate("{{product.name}}", numericName)).toBe("");
  });

  it("leaves placeholders with spaces or malformed keys untouched", () => {
    // 正则只认 {{word.word}},带空格的占位符保持原样(现行契约)
    expect(interpolateTemplate("{{ product.name }}", context)).toBe("{{ product.name }}");
    expect(interpolateTemplate("{{product..name}}", context)).toBe("{{product..name}}");
  });
});

describe("buildTemplateContext", () => {
  it("maps the platform to its abbreviation and defaults the link to empty", () => {
    const context = buildTemplateContext({
      productName: "星河漫剧",
      productDescription: "每周三更新",
      platform: "twitter",
    });
    expect(context.product).toEqual({ name: "星河漫剧", description: "每周三更新", link: "" });
    expect(context.platform).toBe("X");
    expect(context.date).toBe(new Date().toLocaleDateString("zh-CN"));
  });

  it("keeps an explicit product link", () => {
    const context = buildTemplateContext({
      productName: "n",
      productDescription: "d",
      productLink: "https://cta.example.com",
      platform: "douyin",
    });
    expect(context.product.link).toBe("https://cta.example.com");
    expect(context.platform).toBe("抖音");
  });
});

describe("checkForbiddenWords", () => {
  it("returns no hits for an empty allowlist or clean text", () => {
    expect(checkForbiddenWords("任意文案", [])).toEqual([]);
    expect(checkForbiddenWords("全新上线", ["最火"])).toEqual([]);
  });

  it("matches case-insensitively and reports each word once", () => {
    expect(checkForbiddenWords("全网最火 TOP1 推荐", ["最火", "TOP1", "不存在"])).toEqual(["最火", "TOP1"]);
    expect(checkForbiddenWords("Best EVER and best ever", ["best ever"])).toEqual(["best ever"]);
  });
});

describe("trimForPlatform", () => {
  it("keeps text at or under the limit untouched", () => {
    const exactly = "好".repeat(280);
    expect(trimForPlatform(exactly, "twitter")).toEqual({ trimmed: exactly, wasTruncated: false });
    expect(trimForPlatform("短文", "twitter")).toEqual({ trimmed: "短文", wasTruncated: false });
  });

  it("truncates over-limit text to exactly the limit with an ellipsis", () => {
    const long = "好".repeat(281);
    const { trimmed, wasTruncated } = trimForPlatform(long, "twitter");
    expect(wasTruncated).toBe(true);
    expect(trimmed.length).toBe(280);
    expect(trimmed.endsWith("…")).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("renders title/body, copies tags, and applies the platform trim", () => {
    const result = renderTemplate({
      template: template(),
      productName: "星河漫剧",
      productDescription: "每周三更新的都市奇幻漫剧",
      productLink: "https://example.com",
    });

    expect(result.title).toBe("星河漫剧 上线啦");
    expect(result.body).toContain("每周三更新的都市奇幻漫剧");
    expect(result.body).toContain("https://example.com");
    expect(result.body).toContain("小红书 独家"); // {{platform}} 注入
    expect(result.tags).toEqual(["漫剧", "剧情解说"]);
    expect(result.wasTruncated).toBe(false); // xhs 限额 1000
    expect(result.trimmedBody).toBe(result.body);
  });

  it("trims the body to the template platform's limit", () => {
    const longBody = "趣".repeat(400);
    const result = renderTemplate({
      template: template({ platform: "douyin", bodyTemplate: longBody }), // douyin 限额 300
      productName: "星河漫剧",
      productDescription: "d",
    });
    expect(result.wasTruncated).toBe(true);
    expect(result.trimmedBody.length).toBe(300);
    expect(result.trimmedBody.endsWith("…")).toBe(true);
    expect(result.body).toBe(longBody); // 原始 body 不被破坏
  });

  it("flags forbidden words hit in either the title or the body", () => {
    const result = renderTemplate({
      template: template({ titleTemplate: "全网最火 {{product.name}}" }),
      productName: "星河漫剧",
      productDescription: "史上最强 剧情解说",
      brandProfile: { primaryColor: "#000", tone: ["热血"], forbiddenWords: ["最火", "史上最强", "安全词"] },
    });
    expect(result.forbiddenHits).toEqual(["最火", "史上最强"]);
  });

  it("returns no forbidden hits without a brand profile", () => {
    const result = renderTemplate({
      template: template(),
      productName: "星河漫剧",
      productDescription: "最火漫剧",
    });
    expect(result.forbiddenHits).toEqual([]);
  });
});

describe("renderMultiPlatformPreview", () => {
  const previewsFor = (platforms: SelfMediaPlatform[], bodyLength: number) =>
    renderMultiPlatformPreview({
      template: template({ bodyTemplate: "趣".repeat(bodyLength) }),
      productName: "星河漫剧",
      productDescription: "d",
      brandProfile: { primaryColor: "#000", tone: [], forbiddenWords: ["最火"] },
      targetPlatforms: platforms,
    });

  it("renders one preview per platform with per-platform limits and names", () => {
    const previews = previewsFor(["twitter", "wxGzh", "douyin"], 100);
    expect(previews.map((preview) => preview.platform)).toEqual(["twitter", "wxGzh", "douyin"]);
    expect(previews.map((preview) => preview.platformName)).toEqual(["X", "公众号", "抖音"]);
    expect(previews.map((preview) => preview.charLimit)).toEqual([280, 20000, 300]);
    expect(previews.map((preview) => preview.charCount)).toEqual([100, 100, 100]);
    expect(previews.every((preview) => preview.wasTruncated)).toBe(false);
  });

  it("trims only on platforms whose limit the body exceeds", () => {
    const previews = previewsFor(["twitter", "wxGzh"], 400);
    const [twitter, wxGzh] = previews;
    expect(twitter.wasTruncated).toBe(true);
    expect(twitter.trimmedBody.length).toBe(280);
    expect(wxGzh.wasTruncated).toBe(false);
    expect(wxGzh.trimmedBody.length).toBe(400);
  });

  it("carries forbidden-word hits into every platform preview", () => {
    const previews = renderMultiPlatformPreview({
      template: template({ bodyTemplate: "全网最火的漫剧,{{product.name}}出品" }),
      productName: "星河漫剧",
      productDescription: "d",
      brandProfile: { primaryColor: "#000", tone: [], forbiddenWords: ["最火"] },
      targetPlatforms: ["twitter", "douyin"],
    });
    expect(previews.map((preview) => preview.forbiddenHits)).toEqual([["最火"], ["最火"]]);
  });
});

describe("buildTemplateFill", () => {
  it("produces form-ready title, description, and topic string for the given platform", () => {
    const fill = buildTemplateFill({
      template: template(),
      productName: "星河漫剧",
      productDescription: "每周三更新",
      productLink: "https://example.com",
      platform: "douyin",
    });
    expect(fill.title).toBe("星河漫剧 上线啦");
    expect(fill.description).toContain("抖音 独家"); // platform 按传入平台渲染
    expect(fill.topicString).toBe("#漫剧 #剧情解说");
  });
});

describe("mergeTopicStrings", () => {
  it("deduplicates tags keeping first-seen order across separators", () => {
    expect(mergeTopicStrings("#漫剧 #剧情解说", "#剧情解说 #新番")).toBe("#漫剧 #剧情解说 #新番");
    expect(mergeTopicStrings("#漫剧,推荐", "#漫剧，#新番")).toBe("#漫剧 推荐 #新番");
    expect(mergeTopicStrings("", "#新番")).toBe("#新番");
    expect(mergeTopicStrings("#旧", "")).toBe("#旧");
  });

  it("ignores empty segments", () => {
    expect(mergeTopicStrings("  #漫剧  ", "  ")).toBe("#漫剧");
  });
});
