import crypto from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * 生产构建 CSP 注入。
 *
 * electron loadFile 页面没有 HTTP 响应头可挂,webRequest.onHeadersReceived 对
 * file:// 也不触发,所以渲染层 CSP 只能走 index.html meta 标签;dev 模式
 * (Vite HMR、react-refresh 内联脚本)不注入,仅生产生效。index.html 的内联
 * 主题防闪脚本以构建时计算的 sha256 hash 放行——脚本内容变化会自动重算。
 *
 * 面向现状的宽面:img/media/connect 保留 https:、file: 与自定义协议(media-bridge
 * 回环、AI 内容远程图),核心收紧点是 script-src 'self'(阻断 XSS 注入的外部/
 * 内联脚本)与 object-src 'none'。meta 注入在 <head> 最前,保证其后所有内联
 * 脚本都受策略管辖。
 */
export function buildCspPolicy(inlineScriptHashes: readonly string[]): string {
  const scriptHashes = inlineScriptHashes.map((hash) => `'sha256-${hash}'`).join(' ');
  return [
    "default-src 'self'",
    scriptHashes ? `script-src 'self' ${scriptHashes}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: file: local-image: project-file: toonflow-asset: studio-skill: http: https:",
    "media-src 'self' data: blob: file: local-image: project-file: http://127.0.0.1:* http://localhost:* https:",
    "connect-src 'self' data: blob: local-image: project-file: toonflow-asset: studio-skill: http://127.0.0.1:* http://localhost:* https:",
    "worker-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** 计算 html 中无 src 内联脚本(整段字节)的 sha256 base64 指纹。 */
export function extractInlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    hashes.push(crypto.createHash('sha256').update(match[1], 'utf8').digest('base64'));
  }
  return hashes;
}

export function cspPlugin(): Plugin {
  return {
    name: 'mystudio-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = buildCspPolicy(extractInlineScriptHashes(html));
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`);
      },
    },
  };
}
