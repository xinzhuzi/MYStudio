/**
 * HyperFrames registry 模板依赖内联实证(08-21 渲染路径接线):
 * 用真实模板 + 已下载依赖目录(由 registry-deps-verify.ts 产出的 /tmp 目录)
 * 构建 composition HTML,验证四件事——
 * 1. JS 库(GSAP/D3)内容真实内联进 head <script>
 * 2. 字体 CSS 以 data:font/ URI 内联(离线字形)
 * 3. d3.json(...) 改写为 window.__REGISTRY_DATA__ 预注入(规避 file:// fetch)
 * 4. 缺依赖时窗口降级丢弃、composition 仍可构建(不阻塞渲染)
 *
 * 注意:materialize 有模块级缓存,降级场景(B)必须先于正常场景(A)执行。
 * 运行: cd apps && MYSTUDIO_REGISTRY_DEPS_DIR=/tmp/hy-registry-deps-verify \
 *   vite-node --config build/timeline/vite-node.config.ts build/scripts/registry-inline-proof.ts
 */
import { buildHyperFramesCompositionHtml } from "../../frontend/electron/rendering/plugins/hyperframes/hyperframes-worker";

function buildRequest(windows: Array<{ templateId: string; startUs: number; durationUs: number }>) {
  return {
    schemaVersion: 1,
    projectId: "proof-project",
    chapterId: "proof-chapter",
    revision: 1,
    sourceArtifactSha256: "0".repeat(64),
    inputSha256: "1".repeat(64),
    alphaFormat: "prores4444",
    fps: 30,
    width: 1920,
    height: 1080,
    outputPath: "/tmp/proof-overlay.mov",
    windows: windows.map((w) => ({ templateId: w.templateId, startUs: w.startUs, durationUs: w.durationUs, parameters: {} })),
  } as never;
}

function main(): void {
  const depsDir = process.env.MYSTUDIO_REGISTRY_DEPS_DIR;
  if (!depsDir) {
    console.error("需要 MYSTUDIO_REGISTRY_DEPS_DIR 指向已下载依赖目录");
    process.exit(1);
  }

  const checks: Array<[string, boolean]> = [];

  // 场景 B(先跑,避开物化缓存):依赖目录不存在 → 窗口降级丢弃,composition 仍可构建
  process.env.MYSTUDIO_REGISTRY_DEPS_DIR = "/tmp/hy-deps-nonexistent-xyz";
  const degraded = buildHyperFramesCompositionHtml(
    buildRequest([{ templateId: "hy:vfx-shatter", startUs: 0, durationUs: 2_000_000 }]),
    2_000_000,
  );
  checks.push(["缺依赖降级:窗口丢弃且不抛错", !degraded.includes('class="clip hy-registry-window"')]);
  checks.push(["缺依赖降级:composition 可构建", degraded.includes("<!doctype html>")]);

  // 场景 A:GSAP+字体模板(vfx-shatter)+ 地图数据模板(world-map: d3+topojson+atlas JSON)
  process.env.MYSTUDIO_REGISTRY_DEPS_DIR = depsDir;
  const html = buildHyperFramesCompositionHtml(
    buildRequest([
      { templateId: "hy:vfx-shatter", startUs: 0, durationUs: 2_000_000 },
      { templateId: "hy:world-map", startUs: 2_000_000, durationUs: 2_000_000 },
    ]),
    4_000_000,
  );

  checks.push(["两窗 body 均渲染", (html.match(/class="clip hy-registry-window"/g) ?? []).length === 2]);
  checks.push(["GSAP 库内联(registerPlugin 特征)", /registerplugin/i.test(html)]);
  checks.push(["JS 库体量真实(≥500KB 内联)", html.length >= 500_000]);
  checks.push(["atlas JSON 预注入(__REGISTRY_DATA__)", html.includes(`__REGISTRY_DATA__["world-atlas/2/countries-110m.json"]`)]);
  checks.push(["d3.json 改写(无残余外链调用)", !/d3\.json\("\.\.\//.test(html)]);
  checks.push(["字体 data URI 内联", /data:font\/(woff2|ttf);base64,/.test(html)]);
  checks.push(["registry-deps 相对路径清零", !html.includes("../../registry-deps/")]);
  checks.push(["外部 script src 清零", !/<script[^>]*src="[^"]*registry-deps/.test(html)]);
  checks.push(["head 结构有效(</style>…</head>)", /<\/style>(<style>|<script>|<\/head>)/.test(html)]);

  let pass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "✅" : "❌"} ${name}`);
    if (!ok) pass = false;
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

main();
