/**
 * 主进程外发请求的目标地址守卫(SSRF 收敛)。
 *
 * ai/api-request-ipc 的四个 handler(image / model-test / text-completion /
 * text-stream)是渲染进程驱动的任意 URL 代理;被攻破的 renderer 可借它读
 * 云元数据服务(169.254.169.254 / metadata.google.internal)拿宿主云凭据。
 *
 * 口径:禁 link-local 段与已知云元数据主机名;**放行 RFC1918 私网与环回**
 * ——自建内网 API 中转(new-api 等)是本产品的真实使用场景,不做 DNS 解析
 * 后校验(异步且存在解析竞争),仅对字面量 IP 与黑名单主机名设卡。
 */

const METADATA_HOST_BLOCKLIST = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata.azure.internal",
]);

function isBlockedIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return false;
  // 169.254.0.0/16:IPv4 link-local,含 AWS/GCP/Azure/阿里云元数据端点
  if (octets[0] === 169 && octets[1] === 254) return true;
  // 0.0.0.0 作为请求目标等价本机,拒绝
  return octets.every((value) => value === 0);
}

function isBlockedIpv6(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!bare.includes(":")) return false;
  // fe80::/10:IPv6 link-local
  return /^fe[89ab][0-9a-f](:|$)/.test(bare);
}

export function isBlockedOutboundRequestHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (METADATA_HOST_BLOCKLIST.has(normalized)) return true;
  return isBlockedIpv4(normalized) || isBlockedIpv6(normalized);
}

/** 校验外发请求 URL;命中禁段抛错(协议仅允许 http/https)。 */
export function assertSafeOutboundRequestUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 http/https 请求地址");
  }
  if (isBlockedOutboundRequestHost(parsed.hostname)) {
    throw new Error(`请求目标地址被安全策略拒绝: ${parsed.hostname}`);
  }
  return parsed.toString();
}
