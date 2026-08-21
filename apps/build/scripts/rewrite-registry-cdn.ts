/**
 * HyperFrames Registry CDN URL 重写(08-21 Child1):
 * 扫描 assets/hyperframes-registry/{blocks,components}/*.html,
 * 将 CDN 引用(jsdelivr/fonts.googleapis/cdnjs)替换为本地相对路径,
 * 输出 cdn-url-map.json 供运行时按 CDN URL 查本地缓存路径。
 *
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/rewrite-registry-cdn.ts
 */
import fs from "node:fs";
import path from "node:path";

const REGISTRY_DIR = path.join(__dirname, "../../frontend/assets/hyperframes-registry");
const MAP_PATH = path.join(REGISTRY_DIR, "cdn-url-map.json");

/** CDN URL → 本地依赖路径(相对 registry-deps 根) */
const CDN_TO_LOCAL: Record<string, string> = {
  // GSAP
  "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js": "gsap/3.14.2/gsap.min.js",
  // Three.js (两版本)
  "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js": "three/0.147.0/three.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js": "three/0.184.0/three.module.js",
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js": "three/r128/three.min.js",
  // Three.js loaders/postprocessing
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/DRACOLoader.js": "three/0.147.0/DRACOLoader.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js": "three/0.147.0/GLTFLoader.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/postprocessing/EffectComposer.js": "three/0.147.0/EffectComposer.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/postprocessing/RenderPass.js": "three/0.147.0/RenderPass.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/postprocessing/ShaderPass.js": "three/0.147.0/ShaderPass.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/postprocessing/UnrealBloomPass.js": "three/0.147.0/UnrealBloomPass.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/shaders/CopyShader.js": "three/0.147.0/CopyShader.js",
  "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/shaders/LuminosityHighPassShader.js": "three/0.147.0/LuminosityHighPassShader.js",
  // D3
  "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js": "d3/7/d3.min.js",
  // TopoJSON
  "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js": "topojson-client/3.1.0/topojson-client.min.js",
  // Atlas data
  "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json": "us-atlas/3/states-10m.json",
  "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.js": "us-atlas/3/states-10m.js",
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json": "world-atlas/2/countries-110m.json",
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.js": "world-atlas/2/countries-110m.js",
  "https://cdn.jsdelivr.net/npm/es-atlas@0.6.0/es/autonomous_regions.json": "es-atlas/0.6.0/autonomous_regions.json",
  "https://cdn.jsdelivr.net/npm/es-atlas@0.6.0/es/autonomous_regions.js": "es-atlas/0.6.0/autonomous_regions.js",
  // Font woff2
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto-flex@5.2.8/files/roboto-flex-latin-standard-normal.woff2": "fonts/roboto-flex/roboto-flex-latin-standard-normal.woff2",
};

/** Google Fonts @import → 本地 CSS 文件 */
const GOOGLE_FONT_MAP: Record<string, string> = {};
// 在扫描时动态填充

function main(): void {
  const map: Record<string, string> = { ...CDN_TO_LOCAL };
  let totalFiles = 0;
  let modifiedFiles = 0;
  let totalReplacements = 0;
  const fontImports = new Set<string>();

  const dirs = ["blocks", "components"];
  for (const dir of dirs) {
    const dirPath = path.join(REGISTRY_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;

    for (const entry of fs.readdirSync(dirPath)) {
      const htmlPath = path.join(dirPath, entry, `${entry}.html`);
      if (!fs.existsSync(htmlPath)) continue;
      totalFiles++;
      let content = fs.readFileSync(htmlPath, "utf8");
      let modified = false;

      // 替换已知 CDN 引用
      for (const [cdn, local] of Object.entries(CDN_TO_LOCAL)) {
        if (content.includes(cdn)) {
          // 相对路径: 从 registry/<dir>/<name>/ 到 registry-deps/
          const rel = `../../registry-deps/${local}`;
          content = content.split(cdn).join(rel);
          modified = true;
          totalReplacements++;
        }
      }

      // 处理 Google Fonts @import
      const fontMatches = content.matchAll(/@import\s+url\(["']?(https:\/\/fonts\.googleapis\.com\/css2\?[^)"']+)["']?\)/g);
      for (const m of fontMatches) {
        const fontUrl = m[1];
        const familyMatch = fontUrl.match(/family=([^&:]+)/);
        if (familyMatch) {
          const family = familyMatch[1].replace(/\+/g, "-");
          fontImports.add(family);
          const localCss = `../../registry-deps/fonts/${family}/${family}.css`;
          GOOGLE_FONT_MAP[fontUrl] = localCss;
          content = content.replace(m[0], `@import url("${localCss}")`);
          modified = true;
          totalReplacements++;
        }
      }

      if (modified) {
        fs.writeFileSync(htmlPath, content, "utf8");
        modifiedFiles++;
      }
    }
  }

  // 合并字体映射
  Object.assign(map, GOOGLE_FONT_MAP);

  // 写 cdn-url-map.json
  fs.writeFileSync(MAP_PATH, JSON.stringify({
    version: 1,
    description: "CDN URL → 本地依赖路径映射(渲染时按 URL 查缓存位置)",
    registryDepsRoot: "hyperframes-registry-deps",
    mappings: map,
  }, null, 2));

  console.log(`Scanned: ${totalFiles} files`);
  console.log(`Modified: ${modifiedFiles} files`);
  console.log(`Replacements: ${totalReplacements}`);
  console.log(`Google Fonts: ${fontImports.size} families`);
  console.log(`Map written: ${MAP_PATH}`);
}

main();
