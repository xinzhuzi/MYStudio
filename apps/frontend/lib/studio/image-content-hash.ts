// 分镜图内容哈希(1125 人审硬门基建):把「批准绑定图片字节」与「发车前对账」
// 共用的 SHA-256 助手收在一处。computeProjectFileSha256 自 remotion-shot-plan-
// builder.ts 原样迁出(该文件改 import,行为零变)。
import type { StoryboardItem } from "@/types/studio-storyboard-types";

function subtleDigestSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 Web Crypto is unavailable");
  return subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

/** base64 图片数据(data URL 或裸 base64)→ SHA-256 hex。发车链已持有字节时
 *  直用本函数,免二次读盘。解码失败抛错由调用方转业务文案。 */
export async function sha256FromBase64Image(base64: string): Promise<string> {
  const payload = base64.slice(base64.indexOf(",") + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return subtleDigestSha256(bytes);
}

export function isValidSha256Hex(value: string | undefined | null): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** 项目内相对路径文件 → SHA-256 hex;读不到返回 undefined(调用方兜底)。 */
export async function computeProjectFileSha256(
  bridge: NonNullable<Window["projectFiles"]>,
  url: string,
): Promise<string | undefined> {
  try {
    const reply = await bridge.readAsBase64(url);
    if (!reply?.success || !reply.base64) return undefined;
    return await sha256FromBase64Image(reply.base64);
  } catch {
    return undefined;
  }
}

/** projectFiles 桥读 storyboard.mediaRef.path 的实际字节并返回哈希;
 *  非项目相对路径/读不到=undefined。 */
export async function readStoryboardMediaContentSha256(
  storyboard: Pick<StoryboardItem, "mediaRef">,
  projectId: string,
  parseProjectRelativePath: (projectId: string, path: string) => string | undefined,
  buildProjectFileUrl: (projectId: string, relativePath: string) => string,
): Promise<string | undefined> {
  const media = storyboard.mediaRef;
  const bridge = typeof window === "undefined" ? undefined : window.projectFiles;
  if (!media?.path.trim() || !bridge?.readAsBase64) return undefined;
  const relativePath = parseProjectRelativePath(projectId, media.path);
  if (!relativePath) return undefined;
  return computeProjectFileSha256(bridge, buildProjectFileUrl(projectId, relativePath));
}
