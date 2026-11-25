import { describe, expect, it } from "vitest";
import type { Product } from "@/types/product";
import {
  buildShowcaseLinkUrl,
  ctaLabelFor,
  escapeHtml,
  isSafeHttpUrl,
  renderDetailMarkdown,
  showcaseCtaText,
} from "./showcase";

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

describe("escapeHtml", () => {
  it("转义五个实体字符,包括引号和单引号", () => {
    expect(escapeHtml('<a href="x" class=\'y\'>&')).toBe(
      "&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;",
    );
  });

  it("& 先转义,已有实体不会被二次吃掉", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("无特殊字符的文本(含中文)原样返回", () => {
    expect(escapeHtml("创意工作室 · 数字产品集合")).toBe("创意工作室 · 数字产品集合");
    expect(escapeHtml("")).toBe("");
  });

  it("常见注入载荷转义后不再含可执行的标签结构", () => {
    const escaped = escapeHtml('<img src=x onerror="alert(1)">');
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain('onerror="');
    expect(escaped).toContain("&lt;img");
  });
});

describe("isSafeHttpUrl", () => {
  it.each(["http://example.com", "https://example.com/a?b=1#frag"])("放行 %s", (url) => {
    expect(isSafeHttpUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "vbscript:msgbox",
    "/relative/path",
    "example.com/no-scheme",
    "",
  ])("拒绝 %s", (url) => {
    expect(isSafeHttpUrl(url)).toBe(false);
  });
});

describe("ctaLabelFor", () => {
  it("五种 CTA 类型各有措辞,与产品表单下拉同名", () => {
    expect(ctaLabelFor("access")).toBe("接入");
    expect(ctaLabelFor("read")).toBe("阅读");
    expect(ctaLabelFor("download")).toBe("下载");
    expect(ctaLabelFor("learn_more")).toBe("了解更多");
    expect(ctaLabelFor("community")).toBe("加入社区");
  });

  it("未知与空值兜底「查看」", () => {
    expect(ctaLabelFor("unknown")).toBe("查看");
    expect(ctaLabelFor("")).toBe("查看");
  });
});

describe("showcaseCtaText", () => {
  it("链接有按钮文字时用按钮文字", () => {
    expect(showcaseCtaText("官网", "access")).toBe("官网");
  });

  it("留空回落 CTA 类型措辞", () => {
    expect(showcaseCtaText("", "community")).toBe("加入社区");
    expect(showcaseCtaText("", "read")).toBe("阅读");
  });
});

describe("buildShowcaseLinkUrl", () => {
  it("http(s) 链接追加 UTM 三件套,campaign 取推广配置", () => {
    const url = buildShowcaseLinkUrl("https://example.com/doc", makeProduct());
    expect(url).toBe("https://example.com/doc?utm_source=showcase&utm_medium=referral&utm_campaign=autumn");
  });

  it("推广 campaign 为空时回落 slug", () => {
    const product = makeProduct({ slug: "manying-studio", promotion: { defaultTags: [], utm: { campaign: "" }, ctaType: "access" } });
    const url = buildShowcaseLinkUrl("https://example.com", product);
    expect(url).toContain("utm_campaign=manying-studio");
  });

  it("已有同名 utm_* 参数不覆盖,其余补齐", () => {
    const url = buildShowcaseLinkUrl(
      "https://example.com/?utm_source=weibo&utm_medium=social&utm_campaign=own&utm_term=keep",
      makeProduct(),
    );
    expect(url).toContain("utm_source=weibo");
    expect(url).toContain("utm_medium=social");
    expect(url).toContain("utm_campaign=own");
    expect(url).toContain("utm_term=keep");
    expect(url).not.toContain("showcase");
    expect(url).not.toContain("referral");
    expect(url).not.toContain("autumn");
  });

  it("只带部分 utm 参数时缺的补上、有的不动", () => {
    const url = buildShowcaseLinkUrl("https://example.com/?utm_source=weibo", makeProduct());
    expect(url).toContain("utm_source=weibo");
    expect(url).toContain("utm_medium=referral");
    expect(url).toContain("utm_campaign=autumn");
  });

  it("原有查询参数与路径锚点保留", () => {
    const url = buildShowcaseLinkUrl("https://example.com/doc?plan=pro#pricing", makeProduct());
    expect(url).toContain("plan=pro");
    expect(url).toContain("#pricing");
    expect(url).toContain("utm_source=showcase");
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/file",
    "mailto:a@example.com",
    "data:text/html,<script>",
  ])("非 http(s) 的合法 URL 原样返回:%s", (linkUrl) => {
    expect(buildShowcaseLinkUrl(linkUrl, makeProduct())).toBe(linkUrl);
  });

  it.each(["不是地址", "/relative", "example.com/no-scheme", ""])("非法 URL 原样返回:%s", (linkUrl) => {
    expect(buildShowcaseLinkUrl(linkUrl, makeProduct())).toBe(linkUrl);
  });
});

describe("renderDetailMarkdown", () => {
  it("空行分段,连续行并入同一段", () => {
    const html = renderDetailMarkdown("第一段第一行\n第一段第二行\n\n第二段");
    expect(html).toBe("<p>第一段第一行\n第一段第二行</p>\n<p>第二段</p>");
  });

  it("#/##/### 分别映射 h1/h2/h3", () => {
    const html = renderDetailMarkdown("# 一级\n## 二级\n### 三级");
    expect(html).toBe("<h1>一级</h1>\n<h2>二级</h2>\n<h3>三级</h3>");
  });

  it("四级及以上井号不是标题,按普通段落输出", () => {
    const html = renderDetailMarkdown("#### 四级");
    expect(html).toBe("<p>#### 四级</p>");
  });

  it("连续 - 行合成一个列表", () => {
    const html = renderDetailMarkdown("- 甲\n- 乙\n\n- 丙");
    expect(html).toBe("<ul><li>甲</li><li>乙</li></ul>\n<ul><li>丙</li></ul>");
  });

  it("行内 **粗**、*斜*、`码` 分别变换", () => {
    const html = renderDetailMarkdown("**粗** 与 *斜* 与 `码`");
    expect(html).toBe("<p><strong>粗</strong> 与 <em>斜</em> 与 <code>码</code></p>");
  });

  it("码段内容不再做粗斜变换", () => {
    const html = renderDetailMarkdown("`**x** *y*`");
    expect(html).toBe("<p><code>**x** *y*</code></p>");
  });

  it("标题与列表里也做行内变换", () => {
    const html = renderDetailMarkdown("## **重点**清单\n- `api` 接口");
    expect(html).toBe("<h2><strong>重点</strong>清单</h2>\n<ul><li><code>api</code> 接口</li></ul>");
  });

  it("HTML 原文先被转义,再不会出现可执行标签(转义先行)", () => {
    const html = renderDetailMarkdown('正文<script>alert(1)</script>与 <img src=x onerror="y">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("CRLF 行尾与 LF 等价", () => {
    expect(renderDetailMarkdown("# 标题\r\n\r\n正文")).toBe(renderDetailMarkdown("# 标题\n\n正文"));
  });

  it("空输入输出空串", () => {
    expect(renderDetailMarkdown("")).toBe("");
    expect(renderDetailMarkdown("\n\n")).toBe("");
  });
});
