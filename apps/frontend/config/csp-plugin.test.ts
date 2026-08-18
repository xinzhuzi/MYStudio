import { describe, expect, it } from "vitest";
import { buildCspPolicy, cspPlugin, extractInlineScriptHashes } from "./csp-plugin";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <script>
      document.documentElement.classList.add('dark');
    </script>
    <script type="module" src="/main.tsx"></script>
  </head>
  <body></body>
</html>`;

describe("extractInlineScriptHashes", () => {
  it("hashes inline scripts and skips scripts with src", () => {
    const hashes = extractInlineScriptHashes(SAMPLE_HTML);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("produces a stable hash for identical content", () => {
    expect(extractInlineScriptHashes(SAMPLE_HTML)).toEqual(extractInlineScriptHashes(SAMPLE_HTML));
  });

  it("hashes CRLF sources identically to LF (HTML parser normalizes newlines before CSP)", () => {
    // 回归:渲染 index.html 曾被编辑器写入混合 CRLF/LF,原始字节哈希与 Chromium
    // 解析后内容的哈希错位,主题防闪脚本被 CSP 拦截(installed smoke 红)。
    const crlfHtml = SAMPLE_HTML.replace(/\n/g, "\r\n");
    expect(extractInlineScriptHashes(crlfHtml)).toEqual(extractInlineScriptHashes(SAMPLE_HTML));
    const loneCrHtml = SAMPLE_HTML.replace(/\n/g, "\r");
    expect(extractInlineScriptHashes(loneCrHtml)).toEqual(extractInlineScriptHashes(SAMPLE_HTML));
  });
});

describe("buildCspPolicy", () => {
  it("embeds inline script hashes into script-src", () => {
    const policy = buildCspPolicy(["abc123"]);
    expect(policy).toContain("script-src 'self' 'sha256-abc123'");
  });

  it("keeps the hardening directives", () => {
    const policy = buildCspPolicy([]);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("https://fonts.googleapis.com");
    expect(policy).toContain("http://127.0.0.1:*");
    expect(policy).toContain("local-image:");
    expect(policy).toContain("project-file:");
  });
});

describe("cspPlugin", () => {
  it("injects the CSP meta at the start of head on build", () => {
    const plugin = cspPlugin();
    if (typeof plugin.transformIndexHtml !== "object" || !plugin.transformIndexHtml) {
      throw new Error("transformIndexHtml missing");
    }
    const result = plugin.transformIndexHtml.handler(SAMPLE_HTML);
    expect(result).toMatch(/<head>\n    <meta http-equiv="Content-Security-Policy" content="[^"]+">/);
    expect(result).toContain("'sha256-");
    // 主题内联脚本仍完整保留
    expect(result).toContain("document.documentElement.classList.add('dark')");
  });

  it("only applies to builds (apply: 'build')", () => {
    expect(cspPlugin().apply).toBe("build");
  });
});
