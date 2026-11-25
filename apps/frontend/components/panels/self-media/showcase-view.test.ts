// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Product, ProductCtaType } from "@/types/product";
import { isProduct } from "@/lib/product/__fixtures__/product-contract";
import { generateShowcaseHTML, type ShowcaseConfig } from "./showcase-view";

/** 展示页模板里固定的脚本元素数：两个数据块。A3 后无 CDN 与主脚本——正文在生成期静态渲染，零运行时脚本。 */
const TEMPLATE_SCRIPT_COUNT = 2;

// 行分隔符与段分隔符在源码里不可见，一律用码点构造，保证本文件是纯 ASCII。
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "漫影工作室",
    slug: "manying-studio",
    description: "一句话描述",
    detail: "# 详情\n\n正文",
    coverImage: "",
    links: [{ label: "官网", url: "https://example.com", platform: "web" }],
    tags: ["视频", "创作"],
    projectIds: ["project-1"],
    brandProfile: { primaryColor: "", tone: [], forbiddenWords: [] },
    promotion: { defaultTags: ["漫剧"], utm: { campaign: "autumn" }, ctaType: "learn_more" },
    createdAt: 1700000000000,
    updatedAt: 1700000000001,
    ...overrides,
  };
}

const config: ShowcaseConfig = {
  brandName: "MYStudio",
  brandTagline: "创意工作室 · 数字产品集合",
  contactEmail: "contact@example.com",
  socialLinks: [{ platform: "xhs", url: "https://xhs.example.com/mystudio" }],
};

/**
 * 取出脚本数据块的文本。非贪婪匹配停在开标签之后的第一个 </script>，
 * 也就是 HTML 解析器结束这个脚本元素的位置：数据块被提前截断时，这里拿到的就是残缺的 JSON。
 */
function readDataBlock(html: string, id: string): string {
  const match = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html);
  if (!match) throw new Error(`展示页里没有数据块 ${id}`);
  return match[1]!;
}

function parseDataBlocks(html: string): { products: unknown; config: unknown } {
  return {
    products: JSON.parse(readDataBlock(html, "products-data")),
    config: JSON.parse(readDataBlock(html, "config-data")),
  };
}

/** 再用真正的 HTML 解析器读一遍：数据块被提前截断时，后面的内容会变成多出来的脚本元素。 */
function parseWithHtmlParser(html: string): { products: string | null; config: string | null; scriptCount: number } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return {
    products: parsed.getElementById("products-data")?.textContent ?? null,
    config: parsed.getElementById("config-data")?.textContent ?? null,
    scriptCount: parsed.querySelectorAll("script").length,
  };
}

function expectRoundTrip(products: Product[], showConfig: ShowcaseConfig = config) {
  const html = generateShowcaseHTML(products, showConfig);
  const blocks = parseDataBlocks(html);
  expect(blocks.products).toEqual(products);
  expect(blocks.config).toEqual(showConfig);
  // 两个数据块的文本里不出现任何 `<`:`</script>`、`<!--`、`<script` 都因此写不进脚本块
  expect(readDataBlock(html, "products-data")).not.toContain("<");
  expect(readDataBlock(html, "config-data")).not.toContain("<");
  for (const product of products) expect(isProduct(product)).toBe(true);
  for (const product of blocks.products as Product[]) expect(isProduct(product)).toBe(true);

  const dom = parseWithHtmlParser(html);
  expect(JSON.parse(dom.products!)).toEqual(products);
  expect(JSON.parse(dom.config!)).toEqual(showConfig);
  expect(dom.scriptCount).toBe(TEMPLATE_SCRIPT_COUNT);
}

describe("generateShowcaseHTML 的内嵌数据块", () => {
  it("brandProfile 留空的产品往返后与输入深度相等", () => {
    expectRoundTrip([makeProduct()]);
  });

  it("brandProfile 有值的产品往返后与输入深度相等", () => {
    expectRoundTrip([
      makeProduct({
        id: "product-filled",
        brandProfile: { primaryColor: "#336699", tone: ["轻松", "克制"], forbiddenWords: ["最", "第一"] },
      }),
    ]);
  });

  it.each<ProductCtaType>(["access", "read", "download", "learn_more", "community"])(
    "ctaType 为 %s 时往返后与输入深度相等",
    (ctaType) => {
      expectRoundTrip([makeProduct({ promotion: { defaultTags: [], utm: { campaign: "" }, ctaType } })]);
    },
  );

  it("多条产品时整份数组往返后顺序与内容都不变", () => {
    expectRoundTrip([
      makeProduct({ id: "product-a", slug: "a", links: [] }),
      makeProduct({ id: "product-b", slug: "b", tags: ["甲", "乙", "丙", "丁"], links: [{ label: "下载", url: "https://example.com/download", platform: "web" }] }),
    ]);
  });

  it("detail 里带 </script>、<!--、<script 和行分隔符时仍能完整还原", () => {
    // 最坏形态：`<!--` 之后出现 `<script`，且其后不再出现 `-->`。
    // HTML 解析器此时进入双重转义状态，数据块自己的 </script> 只退出该状态、不闭合元素，
    // 脚本会一路吞到文件尾；数据里若出现 `</script>`，脚本块则在那里提前结束。
    const hostile = [
      "开头</script><script>globalThis.__showcaseInjected = true</script>",
      "<!-- 这个注释开始之后不结束，后面跟一个开标签",
      "<script>",
      "行分隔符" + LINE_SEPARATOR + "段分隔符" + PARAGRAPH_SEPARATOR + "结束",
    ].join("\n");
    expect(hostile).toContain("</script>");
    expect(hostile.indexOf("<!--")).toBeLessThan(hostile.lastIndexOf("<script>"));
    expect(hostile).not.toContain("-->");
    expect(hostile).toContain(LINE_SEPARATOR);
    expect(hostile).toContain(PARAGRAPH_SEPARATOR);

    expectRoundTrip([makeProduct({ detail: hostile })]);
  });

  it("配置块里的品牌名带引号和 </script> 时仍能完整还原", () => {
    const hostileConfig: ShowcaseConfig = {
      ...config,
      brandName: '品牌 "引号" \'单引号\' </script><script>globalThis.__showcaseInjected = true</script>',
      brandTagline: "标语</script><!-- <script> 注释不结束" + LINE_SEPARATOR,
    };
    expect(hostileConfig.brandName).toContain('"');
    expect(hostileConfig.brandName).toContain("</script>");
    expect(hostileConfig.brandTagline).toContain("<!-- <script>");
    expect(hostileConfig.brandTagline).not.toContain("-->");
    expect(hostileConfig.brandTagline).toContain(LINE_SEPARATOR);

    expectRoundTrip([makeProduct()], hostileConfig);
  });
});

describe("generateShowcaseHTML 的转义与安全(A2/A3)", () => {
  it("品牌名/标语带 HTML 时 title、meta、hero 输出转义文本,不产生额外脚本元素", () => {
    const hostile: ShowcaseConfig = {
      ...config,
      brandName: "坏品牌</title><script>globalThis.__showcaseTitleInjected = true</script>",
      brandTagline: '标语" onmouseover="alert(1)',
    };
    const html = generateShowcaseHTML([makeProduct()], hostile);
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelector("title")?.textContent).toBe(`${hostile.brandName} - 产品展示`);
    expect(dom.querySelector("meta[name='description']")?.getAttribute("content")).toBe(hostile.brandTagline);
    expect(dom.querySelector(".showcase-hero h1")?.textContent).toBe(hostile.brandName);
    expect(dom.querySelector(".showcase-hero p")?.textContent).toBe(hostile.brandTagline);
    expect(dom.querySelectorAll("script")).toHaveLength(TEMPLATE_SCRIPT_COUNT);
    expect(html).not.toContain("<script>globalThis.__showcaseTitleInjected");
  });

  it("产品名/描述/标签里的 HTML 一律转义", () => {
    const product = makeProduct({
      name: '<img src=x onerror="alert(1)">',
      description: "描述<script>attack()</script>",
      tags: ["<b>加粗</b>"],
    });
    const html = generateShowcaseHTML([product], config);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>attack()");
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelector(".showcase-card-body h3")?.textContent).toBe(product.name);
    expect(dom.querySelector(".showcase-card-desc")?.textContent).toBe(product.description);
    expect(dom.querySelector(".showcase-pill")?.textContent).toBe("<b>加粗</b>");
    expect(dom.querySelectorAll("script")).toHaveLength(TEMPLATE_SCRIPT_COUNT);
  });

  it.each(["javascript:alert(1)", "data:image/png;base64,AAAA", "/local/cover.png", ""])(
    "非 http(s) 封面跳过整个 img:%s",
    (coverImage) => {
      const html = generateShowcaseHTML([makeProduct({ coverImage })], config);
      expect(html).not.toContain("<img");
    },
  );

  it("http(s) 封面正常输出 img", () => {
    const html = generateShowcaseHTML([makeProduct({ coverImage: "https://example.com/cover.png" })], config);
    expect(html).toContain('<img class="showcase-card-img" src="https://example.com/cover.png"');
  });

  it("非 http(s) 产品链接降级为纯文本,不输出 href", () => {
    const html = generateShowcaseHTML(
      [makeProduct({ links: [{ label: "坏链接", url: "javascript:alert(1)", platform: "web" }] })],
      config,
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("showcase-cta-static");
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelector(".showcase-links a")).toBeNull();
    expect(dom.querySelector(".showcase-links span")?.textContent).toBe("坏链接");
  });
});

describe("generateShowcaseHTML 的 CTA 与 UTM(A4)", () => {
  it("导出链接带 UTM 三件套,campaign 取推广配置", () => {
    const html = generateShowcaseHTML([makeProduct()], config);
    const dom = new DOMParser().parseFromString(html, "text/html");
    const href = dom.querySelector(".showcase-links a")?.getAttribute("href") ?? "";
    const url = new URL(href);
    expect(`${url.origin}${url.pathname}`).toBe("https://example.com/");
    expect(url.searchParams.get("utm_source")).toBe("showcase");
    expect(url.searchParams.get("utm_medium")).toBe("referral");
    expect(url.searchParams.get("utm_campaign")).toBe("autumn");
  });

  it("已有同名 utm_* 参数不覆盖,缺的补上", () => {
    const html = generateShowcaseHTML(
      [makeProduct({ links: [{ label: "落地页", url: "https://example.com/lp?utm_source=weibo", platform: "web" }] })],
      config,
    );
    const dom = new DOMParser().parseFromString(html, "text/html");
    const url = new URL(dom.querySelector(".showcase-links a")!.getAttribute("href")!);
    expect(url.searchParams.get("utm_source")).toBe("weibo");
    expect(url.searchParams.get("utm_medium")).toBe("referral");
    expect(url.searchParams.get("utm_campaign")).toBe("autumn");
  });

  it("推广 campaign 为空时 utm_campaign 取 slug", () => {
    const html = generateShowcaseHTML(
      [makeProduct({ slug: "manying-studio", promotion: { defaultTags: [], utm: { campaign: "" }, ctaType: "access" } })],
      config,
    );
    const dom = new DOMParser().parseFromString(html, "text/html");
    const url = new URL(dom.querySelector(".showcase-links a")!.getAttribute("href")!);
    expect(url.searchParams.get("utm_campaign")).toBe("manying-studio");
  });

  it("链接按钮文字留空时回落 CTA 类型措辞,有文字时用按钮文字", () => {
    const empty = generateShowcaseHTML(
      [makeProduct({ promotion: { defaultTags: [], utm: { campaign: "" }, ctaType: "community" }, links: [{ label: "", url: "https://example.com/join", platform: "web" }] })],
      config,
    );
    const emptyDom = new DOMParser().parseFromString(empty, "text/html");
    expect(emptyDom.querySelector(".showcase-links a")?.textContent).toBe("加入社区");

    const labeled = generateShowcaseHTML([makeProduct()], config);
    const labeledDom = new DOMParser().parseFromString(labeled, "text/html");
    expect(labeledDom.querySelector(".showcase-links a")?.textContent).toBe("官网");
  });
});

describe("generateShowcaseHTML 的详细描述与底部(A10/A11)", () => {
  it("detail 渲染为零 JS 的 details 折叠块,Markdown 变换且先转义", () => {
    const product = makeProduct({
      detail: "# 标题\n\n正文 **加粗** 与 `码`\n\n- 列表项\n\n<script>attack()</script>",
    });
    const html = generateShowcaseHTML([product], config);
    const dom = new DOMParser().parseFromString(html, "text/html");
    const details = dom.querySelector("details.showcase-detail");
    expect(details).not.toBeNull();
    expect(details!.querySelector(".showcase-detail-body h1")?.textContent).toBe("标题");
    expect(details!.querySelector(".showcase-detail-body strong")?.textContent).toBe("加粗");
    expect(details!.querySelector(".showcase-detail-body code")?.textContent).toBe("码");
    expect(details!.querySelectorAll("li")).toHaveLength(1);
    expect(details!.querySelector(".showcase-detail-body script")).toBeNull();
    expect(html).not.toContain("<script>attack()");
  });

  it("空白 detail 不输出折叠块", () => {
    const html = generateShowcaseHTML([makeProduct({ detail: "  \n\t " })], config);
    expect(html).not.toContain("<details");
  });

  it("社媒链接渲染在底部:http(s) 出链接,非 http(s) 降级纯文本", () => {
    const socialConfig: ShowcaseConfig = {
      ...config,
      socialLinks: [
        { platform: "小红书", url: "https://xhs.example.com/mystudio" },
        { platform: "坏链", url: "javascript:alert(1)" },
      ],
    };
    const html = generateShowcaseHTML([makeProduct()], socialConfig);
    const dom = new DOMParser().parseFromString(html, "text/html");
    const anchors = dom.querySelectorAll(".showcase-social a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.getAttribute("href")).toBe("https://xhs.example.com/mystudio");
    expect(anchors[0]!.textContent).toBe("小红书");
    expect(dom.querySelector(".showcase-social span")?.textContent).toBe("坏链");
    expect(html).not.toContain('href="javascript:');
  });

  it("无社媒链接时底部不出 social 块,邮箱与版权仍在", () => {
    const html = generateShowcaseHTML([makeProduct()], {
      ...config,
      socialLinks: [],
      contactEmail: "hi@example.com",
    });
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelector(".showcase-social")).toBeNull();
    expect(dom.querySelector(".showcase-footer-contact")?.textContent).toBe("联系: hi@example.com");
    expect(dom.querySelector(".showcase-footer p:last-child")?.textContent).toContain("MYStudio");
  });
});
