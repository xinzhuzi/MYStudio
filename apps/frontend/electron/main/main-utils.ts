/**
 * main.ts 纯函数工具 — 从 main.ts 拆出(Child 2 R3)。
 *
 * 提取两类零状态依赖的纯函数:
 * 1. update config URL 读取(参数化,接收 config 对象)
 * 2. studio-skill 协议路径编码
 */
import { isNonEmptyString, sanitizeExternalUrl } from "../runtime/update-policy";

/** update config 的最小视图(结构兼容 typedPackageMetadata.updateConfig)。 */
type UpdateConfigLike = {
  manifestUrl?: string;
  defaultGithubUrl?: string;
  defaultBaiduUrl?: string;
  defaultBaiduCode?: string;
};

export function getUpdateManifestUrl(config: UpdateConfigLike): string | undefined {
  return sanitizeExternalUrl(config.manifestUrl);
}

export function getDefaultGithubUrl(config: UpdateConfigLike): string | undefined {
  return sanitizeExternalUrl(config.defaultGithubUrl);
}

export function getDefaultBaiduUrl(config: UpdateConfigLike): string | undefined {
  return sanitizeExternalUrl(config.defaultBaiduUrl);
}

export function getDefaultBaiduCode(config: UpdateConfigLike): string | undefined {
  return isNonEmptyString(config.defaultBaiduCode)
    ? config.defaultBaiduCode.trim()
    : undefined;
}

/** studio-skill 协议路径编码:逐段 encodeURIComponent 后用 / 重组。 */
export function encodePathForProtocol(relativePath: string): string {
  return relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function makeStudioSkillFileUrl(relativePath: string): string {
  return `studio-skill://${encodePathForProtocol(relativePath)}`;
}
