/**
 * B4 推广链接生成器(design.md §B4)。
 * 纯前端实现,不需要 IPC。
 *
 * 已知限制(记录在此,不在代码中承诺):
 * - 部分平台会 strip URL query params(如微信公众号文章内的外链),UTM 追踪在这些平台失效
 * - 短链服务(bit.ly API / 自建)暂不实现,后续按需接入
 * - UTM 追踪效果依赖落地页侧的 analytics(Vercel Analytics / Google Analytics),落地页需预埋
 */

export interface UtmParams {
  /** 流量来源平台,例如"小红书"、"抖音"、"X" */
  source: string;
  /** 媒介类型,固定为 "social" */
  medium: "social";
  /** 推广活动名,通常取 product.promotion.utm.campaign */
  campaign: string;
  /** 内容标识,通常取草稿标题 */
  content?: string;
}

/**
 * 在 baseUrl 上附加 UTM query 参数,返回完整 URL 字符串。
 * 若 baseUrl 本身已含同名 UTM 参数,以传入值覆盖。
 * 若 baseUrl 不是合法 URL,原样返回(不抛异常,UI 层降级显示)。
 */
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("utm_source", params.source);
    url.searchParams.set("utm_medium", params.medium);
    url.searchParams.set("utm_campaign", params.campaign);
    if (params.content) {
      url.searchParams.set("utm_content", params.content);
    }
    return url.toString();
  } catch {
    // baseUrl 不是合法 URL(例如空字符串或相对路径),原样返回
    return baseUrl;
  }
}

/**
 * 复制文本到系统剪贴板。
 * 优先使用 Clipboard API,不可用时降级到 execCommand("copy")。
 * 返回是否成功。
 */
export async function copyUtmToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API 可能因权限/焦点问题失败,降级到 execCommand
    }
  }
  // Fallback: textarea + execCommand("copy")
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
}
