/**
 * 自由生图 images 端点坏点记忆(会话内,TTL 失效)。
 *
 * 08-28 实证:钱咖API 的 /v1/images/edits 稳定返回「HTTP 200 但响应体非
 * JSON」——每镜都先烧一次必败请求(2s),再被网关性失败判定拖进 chat 慢
 * 通道(40~76s)。这类服务端损坏短期内不会自愈,记指纹后直接跳过 images
 * 端点走 chat;images 端点一旦成功立即清除,恢复探测机会。
 */

const POISON_TTL_MS = 10 * 60 * 1000;

const poisoned = new Map<string, number>();

function normalizeKey(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

export function markImagesEndpointPoisoned(providerId: string, model: string): void {
  poisoned.set(normalizeKey(providerId, model), Date.now() + POISON_TTL_MS);
}

export function isImagesEndpointPoisoned(providerId: string, model: string): boolean {
  const expiry = poisoned.get(normalizeKey(providerId, model));
  if (expiry === undefined) return false;
  if (Date.now() >= expiry) {
    poisoned.delete(normalizeKey(providerId, model));
    return false;
  }
  return true;
}

export function clearImagesEndpointPoison(providerId: string, model: string): void {
  poisoned.delete(normalizeKey(providerId, model));
}

/** 测试隔离用 */
export function resetImagesEndpointPoisonMemory(): void {
  poisoned.clear();
}
