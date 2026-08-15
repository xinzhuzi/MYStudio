/**
 * 3D 纵深友好提示词 — 手册驱动加载器。
 *
 * 唯一真相源是技能手册:
 *   assets/studio-manuals/production_skills/depth_friendly_3d.md
 * 代码不写死任何 token —— 生图 token 与 AI 撰写指南均从手册标记块解析:
 *   <!-- depth-tokens:start --> ... <!-- depth-tokens:end -->   （每行一个 token）
 *   <!-- depth-guide:start --> ... <!-- depth-guide:end -->     （AI 系统提示词指南）
 * 修改手册即全局生效；标记块缺失时不注入任何内容（fail-empty，不回退硬编码）。
 *
 * 风格专属纵深条款（如扩展手册水墨版 DV1-DV7）写在各视觉手册的
 * art_storyboard_video.md 中，由 AI 提示词撰写流程按所选风格消费；
 * 代码层的自动追加只使用通用手册 token。
 */

const manualModules = import.meta.glob(
  "../../assets/studio-manuals/production_skills/depth_friendly_3d.md",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const manualContent = Object.values(manualModules)[0] ?? "";

function parseMarkerBlock(content: string, name: string): string {
  const match = content.match(
    new RegExp(`<!-- ${name}:start -->\\n?([\\s\\S]*?)<!-- ${name}:end -->`),
  );
  return match?.[1]?.trim() ?? "";
}

/** 手册解析出的生图 token 列表（每行一个；标记块缺失时为空数组）。 */
export const DEPTH_FRIENDLY_IMAGE_TOKENS: readonly string[] = parseMarkerBlock(manualContent, "depth-tokens")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

/** 追加到生图 prompt 末尾的完整 token 串。 */
export const DEPTH_FRIENDLY_IMAGE_TOKENS_SUFFIX = DEPTH_FRIENDLY_IMAGE_TOKENS.join(", ");

/** AI 系统提示词纵深指南（标记块缺失时为空字符串 → 不注入）。 */
export function getDepthFriendlyGuideZh(): string {
  const guide = parseMarkerBlock(manualContent, "depth-guide");
  return guide ? `\n${guide}\n` : "";
}

/**
 * 给分镜帧生图 prompt 追加纵深友好 token（幂等）。
 * 只用于会成为视频帧源的图（单帧/尾帧/九宫格分镜），
 * 拼页大图、联络表等分析用图不要用。手册无 token 时不追加。
 */
export function withDepthFriendlyTokens(prompt: string): string {
  const base = prompt.trim();
  if (!base || !DEPTH_FRIENDLY_IMAGE_TOKENS_SUFFIX) return base;
  // 幂等: 首个 token 已存在则视为已应用（调用方可能在追加后又拼接了风格后缀）。
  const firstToken = DEPTH_FRIENDLY_IMAGE_TOKENS[0];
  if (firstToken && base.includes(firstToken)) return base;
  return `${base}, ${DEPTH_FRIENDLY_IMAGE_TOKENS_SUFFIX}`;
}
