import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * HyperFrames registry 模板机器——模板加载/物化/内联安全 JS。file-size-reduction P1 拆出,体逐字保留。
 */
export function isRegistryTemplate(templateId: string): boolean {
  return templateId.startsWith("hy:");
}

// registry 模板缓存(避免同段多窗重复读盘);raw 提取结果,依赖物化另行缓存
export const registryTemplateCache = new Map<string, { styles: string; body: string; scripts: string; depRels: string[] }>();

/**
 * registry assets 根:dev 与打包两种落位——
 * - dev: apps/frontend/assets/hyperframes-registry(相对源码)
 * - 打包: Resources/hyperframes-registry(extraResources to: hyperframes-registry)
 */
export function resolveRegistryAssetsRoot(): string {
  // 08-22:env 覆盖(esbuild 单文件 bundle 的 __dirname 相对推导会断链)
  const envRoot = process.env.MYSTUDIO_HYPERFRAMES_REGISTRY_ASSETS?.trim();
  if (envRoot) return envRoot;
  const dev = path.join(__dirname, "../../../../assets/hyperframes-registry");
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath ?? "", "hyperframes-registry");
}

export const REGISTRY_DEP_REF = /\.\.\/\.\.\/registry-deps\/([^\s"'")]+)/g;

/**
 * 加载 registry HTML 模板,提取 <style>/<body>/<script> 内容。
 * blocks 是完整文档(拆出 style+body);components 是片段(直接用)。
 * 外部 <script src="../../registry-deps/..."> 不内联执行,这里剔除标签、
 * 记录依赖清单,由 materializeRegistryTemplate 在渲染时物化。
 */
export function loadRegistryTemplate(templateId: string): { styles: string; body: string; scripts: string; depRels: string[] } {
  const cached = registryTemplateCache.get(templateId);
  if (cached) return cached;
  const name = templateId.slice(3); // strip "hy:"
  const assetsRoot = resolveRegistryAssetsRoot();
  const blockPath = path.join(assetsRoot, "blocks", name, `${name}.html`);
  const componentPath = path.join(assetsRoot, "components", name, `${name}.html`);
  const filePath = fs.existsSync(blockPath) ? blockPath : fs.existsSync(componentPath) ? componentPath : null;
  if (!filePath) throw new Error(`Registry 模板不存在: ${templateId}`);
  const html = fs.readFileSync(filePath, "utf8");

  const depRels = new Set<string>();
  for (const m of html.matchAll(REGISTRY_DEP_REF)) {
    depRels.add(m[1].replace(/[)'"]+$/, ""));
  }

  // 提取 <style> 内容
  const styles: string[] = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    styles.push(m[1]);
  }
  // 提取 <script> 内容(排除外部引用)。
  // 保留含 window.__timelines 的脚本:注册时间线是 HyperFrames CLI 的驱动协议
  // (CLI 逐帧 seek 注册的 timeline),剔除会令模板动画失去同步(308 个模板受累)。
  const scripts: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = m[1].trim();
    if (code) {
      scripts.push(code);
    }
  }
  // 提取 <body> 内容(剔除指向 registry-deps 的外部 script 标签)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const body = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[^>]*src=["'][^"']*registry-deps[^"']*["'][^>]*>\s*<\/script>\s*/g, "")
    .trim();

  const result = { styles: styles.join("\n"), body, scripts: scripts.join("\n"), depRels: [...depRels] };
  registryTemplateCache.set(templateId, result);
  return result;
}

export interface MaterializedRegistryTemplate {
  styles: string;
  body: string;
  scripts: string;
  /** 依赖 JS 库内容(内联进 head,执行先于模板内联脚本) */
  libScripts: string[];
  /** 字体 CSS(_files 字体已转 data URI,内联 <style>) */
  fontStyles: string;
  /** 地图等 JSON 数据预注入(window.__REGISTRY_DATA__) */
  dataPreload: string;
}

const materializedRegistryCache = new Map<string, MaterializedRegistryTemplate | null>();

/** 内联 JS 防 </script> 提前闭合 */
export function inlineSafeJs(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

/**
 * 渲染时物化 registry 模板依赖:JS 库内联、字体 CSS+data URI 内联、
 * d3.json 数据预注入——composition 完全自包含,无 file:// 跨源问题。
 * 依赖缺失或依赖损坏(如截断的 JSON)一律返回 null(调用方降级丢弃该窗,不阻塞整段渲染)。
 */
export function materializeRegistryTemplate(templateId: string): MaterializedRegistryTemplate | null {
  const depsRoot = process.env.MYSTUDIO_REGISTRY_DEPS_DIR?.trim();
  // 缓存键含 depsRoot:依赖目录变化(下载完成/测试切换)不得命中陈旧结果
  const cacheKey = `${depsRoot ?? ""}|${templateId}`;
  if (materializedRegistryCache.has(cacheKey)) return materializedRegistryCache.get(cacheKey) ?? null;
  const raw = loadRegistryTemplate(templateId);
  let result: MaterializedRegistryTemplate | null;
  if (raw.depRels.length === 0) {
    result = { styles: raw.styles, body: raw.body, scripts: raw.scripts, libScripts: [], fontStyles: "", dataPreload: "" };
  } else if (!depsRoot) {
    console.warn(`[hyperframes-worker] ${templateId} 需要特效依赖但未配置 deps 目录;窗口已降级丢弃(设置→视频工作流→HyperFrames 下载依赖)`);
    result = null;
  } else {
    // 路径遏制:依赖相对路径不得逃出 deps 根(防御 map/HTML 被篡改时的路径穿越)
    const rootAbs = path.resolve(depsRoot);
    const safeRel = (rel: string): string | null => {
      const abs = path.resolve(rootAbs, rel);
      return abs.startsWith(rootAbs + path.sep) ? abs : null;
    };
    const missing: string[] = [];
    const relAbs = new Map<string, string>();
    for (const rel of raw.depRels) {
      const abs = safeRel(rel);
      if (abs === null || !fs.existsSync(abs)) missing.push(rel);
      else relAbs.set(rel, abs);
    }
    if (missing.length > 0) {
      console.warn(`[hyperframes-worker] ${templateId} 缺依赖 ${missing.join(", ")};窗口已降级丢弃(设置→视频工作流→HyperFrames 下载依赖)`);
      result = null;
    } else {
      try {
        const libScripts: string[] = [];
        const fontStyles: string[] = [];
        const dataMap: Record<string, unknown> = {};
        for (const [rel, abs] of relAbs) {
          if (rel.endsWith(".js")) {
            libScripts.push(inlineSafeJs(fs.readFileSync(abs, "utf8")));
          } else if (rel.endsWith(".css")) {
            // 字体 CSS:内部 url(_files/x) 转 data URI,整段内联
            let css = fs.readFileSync(abs, "utf8");
            for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
              const ref = m[1].trim().replace(/^["']|["']$/g, "");
              if (/^https?:\/\//.test(ref)) continue;
              const fontAbs = path.join(path.dirname(abs), ref);
              if (!fs.existsSync(fontAbs)) continue;
              const buf = fs.readFileSync(fontAbs);
              const mime = ref.endsWith(".woff2") ? "font/woff2" : ref.endsWith(".woff") ? "font/woff" : "font/ttf";
              css = css.split(`url(${m[1]})`).join(`url(data:${mime};base64,${buf.toString("base64")})`);
            }
            fontStyles.push(css);
          } else if (rel.endsWith(".json")) {
            // 截断/损坏的 JSON 在此抛错,由外层 catch 统一降级——不阻塞整段渲染
            dataMap[rel] = JSON.parse(fs.readFileSync(abs, "utf8"));
          }
        }
        // d3.json("...registry-deps/x.json") → 预注入数据(规避 file:// fetch 限制)
        const scripts = raw.scripts.replace(
          /d3\.json\((["'])(\.\.\/\.\.\/registry-deps\/[^"']+)\1\)/g,
          (_all, _q, url: string) => {
            const rel = url.replace("../../registry-deps/", "");
            return `Promise.resolve(window.__REGISTRY_DATA__[${JSON.stringify(rel)}])`;
          },
        );
        // styles/body 残余 registry-deps 引用(<img href 等)退回 file:// 绝对路径
        // pathToFileURL 正确处理 userData 路径中的空格与中文
        let styles = raw.styles;
        let body = raw.body;
        for (const [rel, abs] of relAbs) {
          const fileUrl = pathToFileURL(abs).href;
          styles = styles.split(`../../registry-deps/${rel}`).join(fileUrl);
          body = body.split(`../../registry-deps/${rel}`).join(fileUrl);
        }
        const dataPreload = Object.keys(dataMap).length
          ? `window.__REGISTRY_DATA__=Object.assign(window.__REGISTRY_DATA__||{},${JSON.stringify(dataMap).replace(/</g, "\\u003c")});`
          : "";
        result = { styles, body, scripts, libScripts, fontStyles: fontStyles.join("\n"), dataPreload };
      } catch (error) {
        console.warn(`[hyperframes-worker] ${templateId} 依赖物化失败(${error instanceof Error ? error.message : String(error)});窗口已降级丢弃`);
        result = null;
      }
    }
  }
  materializedRegistryCache.set(cacheKey, result);
  return result;
}

