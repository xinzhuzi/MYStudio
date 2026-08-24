/**
 * 视觉手册分镜帧风格锁 — 手册驱动加载器。
 *
 * 唯一真相源是所选视觉手册的 art_prompt/art_storyboard_video.md 标记块:
 *   <!-- storyboard-image-style-tokens:start --> ... <!-- storyboard-image-style-tokens:end -->（每行一个 token）
 *   <!-- storyboard-style-guide:start --> ... <!-- storyboard-style-guide:end -->（AI 系统提示词指南）
 * 代码不写死任何 token —— 与 depth-friendly-prompt.ts 同一模式:
 * 标记块缺失时不注入任何内容（fail-empty，不回退硬编码）。
 *
 * 当前仅扩展手册（extended seed）提供标记块；其他风格原样返回。
 * 分镜帧提示词由无风格约束的 LLM 产出，可能携带 cinematic/景深虚化类词——
 * 扩展手册路径先过 sanitizeExtendedManualPrompt 再幂等追加 token，与资产润色链路口径一致。
 */

import { sanitizeExtendedManualPrompt } from "@/lib/ai/prompt-polisher";
import {
  compileDaojieStoryboardFramePrompt,
  DaojiePromptContractError,
  type CompiledDaojiePrompt,
} from "@/lib/ai/daojie-prompt-contract";
import { EXTENDED_VISUAL_MANUAL_SEED_ID } from "@/lib/studio/visual-manual-classification";
import { useStudioStore } from "@/stores/studio/studio-store";

// 2026-08-22 起道劫手册移至项目真源(<项目根>/skills),构建期打包读取改为
// 运行时读取:优先项目 skills → userData/skills(应用内编辑副本)。首次调用现读并缓存,
// 失败/缺失时 fail-empty(不注入,不回退硬编码)——与原语义一致。
const DAOJIE_ART_STORYBOARD_RELATIVE = "art_skills/daojie_ink_guofeng/art_prompt/art_storyboard_video.md";

let manualContentCache: string | null = null;
let manualContentLoading: Promise<string> | null = null;

async function readDaojieArtStoryboardContent(): Promise<string> {
  if (manualContentCache !== null) return manualContentCache;
  if (manualContentLoading) return manualContentLoading;
  manualContentLoading = (async () => {
    let content = "";
    try {
      const projectStore = (await import("@/stores/project/project-store")).useProjectStore.getState();
      const projectId = projectStore.activeProjectId;
      const projectFiles = (await import("@/lib/bridge/project-files")).getProjectFilesBridge();
      if (projectId && projectFiles?.readText) {
        const fromProject = await projectFiles.readText({
          projectId,
          relativePath: `skills/${DAOJIE_ART_STORYBOARD_RELATIVE}`,
        });
        if (fromProject.success && fromProject.text) content = fromProject.text;
      }
      if (!content) {
        const studioSkills = (await import("@/lib/bridge/studio-skills")).getStudioSkillsBridge();
        if (studioSkills?.readText) {
          const fromStored = await studioSkills.readText(DAOJIE_ART_STORYBOARD_RELATIVE);
          if (fromStored.success && fromStored.content) content = fromStored.content;
        }
      }
    } catch {
      content = "";
    }
    manualContentCache = content;
    return content;
  })();
  return manualContentLoading;
}

/** 重置内容缓存(测试用;手册文件更新后由调用方触发重载)。 */
export function resetExtendedManualContentCache(): void {
  manualContentCache = null;
  manualContentLoading = null;
  EXTENDED_FRAME_NEGATIVE_CACHE = "";
  factionDataCache = null;
  factionDataLoading = null;
}

function parseMarkerBlock(content: string, name: string): string {
  const match = content.match(
    new RegExp(`<!-- ${name}:start -->\\n?([\\s\\S]*?)<!-- ${name}:end -->`),
  );
  return match?.[1]?.trim() ?? "";
}

/** 手册解析出的分镜帧生图风格 token 列表（每行一个；标记块缺失时为空数组）。 */
function computeTokens(content: string): string[] {
  return parseMarkerBlock(content, "storyboard-image-style-tokens")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 当前已加载手册内容的 tokens(未加载时为空数组 fail-empty);预热后生效。 */
export const EXTENDED_STORYBOARD_STYLE_TOKENS: readonly string[] = computeTokens("");

/** 预热运行时手册内容(项目/存储侧);应用启动或手册变更后调用一次。
 * 显式传入 content 时跳过桥读取(测试/已知内容场景)。 */
export async function warmExtendedManualStyleTokens(content?: string): Promise<void> {
  if (content === undefined) content = await readDaojieArtStoryboardContent();
  // 显式传入也写缓存:模板解析(getExtendedStoryboardManualContent)与标记块
  // 解析共享同一份内容,避免「令牌已预热而模板为空」的半热状态
  manualContentCache = content;
  manualContentLoading = null;
  (EXTENDED_STORYBOARD_STYLE_TOKENS as string[]).splice(0, EXTENDED_STORYBOARD_STYLE_TOKENS.length, ...computeTokens(content));
  EXTENDED_STORYBOARD_STYLE_TOKENS_SUFFIX = computeTokens(content).join(", ");
  EXTENDED_STYLE_GUIDE_CACHE = parseMarkerBlock(content, "storyboard-style-guide");
  EXTENDED_FRAME_NEGATIVE_CACHE = parseMarkerBlock(content, "storyboard-frame-negative");
}

let EXTENDED_STORYBOARD_STYLE_TOKENS_SUFFIX = EXTENDED_STORYBOARD_STYLE_TOKENS.join(", ");
let EXTENDED_STYLE_GUIDE_CACHE = "";

/** 扩展手册分镜帧风格指南（注入分镜提示词撰写 LLM 的 system；标记块缺失为空字符串 → 不注入）。 */
export function getExtendedStoryboardStyleGuide(): string {
  return EXTENDED_STYLE_GUIDE_CACHE ? `\n${EXTENDED_STYLE_GUIDE_CACHE}\n` : "";
}

/** 分镜帧生图工作流的五类英文负面词(建流时预填 Negative Prompt;标记块缺失为空 → 不预填)。 */
let EXTENDED_FRAME_NEGATIVE_CACHE = "";
export function getExtendedStoryboardFrameNegative(): string {
  return EXTENDED_FRAME_NEGATIVE_CACHE;
}

/** 手册原始内容(预热后;分镜帧模板解析等下游消费,未预热为空串)。 */
export function getExtendedStoryboardManualContent(): string {
  return manualContentCache ?? "";
}

/** 阵营配色数据(art_faction_palette.md;ma-faction-palette-v1 应用侧拷贝)。 */
export interface StoryboardFactionData {
  /** 角色/场景名 → 阵营 */
  members: Record<string, string>;
  /**
   * 阵营 → 各轨五职责色彩串(中文名)。
   * prop 轨 = not_applicable:分镜阵营配色合同(ma-faction-palette-v1)只覆盖 person/scene 两轨,
   * 不为「三轨齐全」凭空新增 prop 配色;仅当未来手册显式提供道具阵营规则时才扩展。
   */
  palette: Record<string, { person: string; scene: string }>;
}

let factionDataCache: StoryboardFactionData | null = null;
let factionDataLoading: Promise<StoryboardFactionData> | null = null;
const DAOJIE_ART_FACTION_RELATIVE = "art_skills/daojie_ink_guofeng/art_prompt/art_faction_palette.md";

function parseFactionContent(content: string): StoryboardFactionData {
  const empty: StoryboardFactionData = { members: {}, palette: {} };
  if (!content) return empty;
  try {
    const members = JSON.parse(parseMarkerBlock(content, "storyboard-faction-members") || "{}");
    const palette = JSON.parse(parseMarkerBlock(content, "storyboard-faction-palette") || "{}");
    if (typeof members !== "object" || typeof palette !== "object") return empty;
    return { members: members as Record<string, string>, palette: palette as StoryboardFactionData["palette"] };
  } catch {
    return empty;
  }
}

function readDaojieArtFactionContent(): Promise<string> {
  return (async () => {
    let content = "";
    try {
      const projectStore = (await import("@/stores/project/project-store")).useProjectStore.getState();
      const projectId = projectStore.activeProjectId;
      const projectFiles = (await import("@/lib/bridge/project-files")).getProjectFilesBridge();
      if (projectId && projectFiles?.readText) {
        const fromProject = await projectFiles.readText({
          projectId,
          relativePath: `skills/${DAOJIE_ART_FACTION_RELATIVE}`,
        });
        if (fromProject.success && fromProject.text) content = fromProject.text;
      }
      if (!content) {
        const studioSkills = (await import("@/lib/bridge/studio-skills")).getStudioSkillsBridge();
        if (studioSkills?.readText) {
          const fromStored = await studioSkills.readText(DAOJIE_ART_FACTION_RELATIVE);
          if (fromStored.success && fromStored.content) content = fromStored.content;
        }
      }
    } catch {
      content = "";
    }
    return content;
  })();
}

/** 预热阵营配色数据(与风格令牌同点调用);显式传入 content 供测试。 */
export async function warmExtendedManualFactionData(content?: string): Promise<StoryboardFactionData> {
  if (content === undefined) {
    if (factionDataCache) return factionDataCache;
    if (factionDataLoading) return factionDataLoading;
    factionDataLoading = readDaojieArtFactionContent().then((raw) => {
      factionDataCache = parseFactionContent(raw);
      return factionDataCache;
    });
    return factionDataLoading;
  }
  factionDataCache = parseFactionContent(content);
  factionDataLoading = null;
  return factionDataCache;
}

/** 当前阵营配色数据(未预热为空结构 fail-empty)。 */
export function getExtendedStoryboardFactionData(): StoryboardFactionData {
  return factionDataCache ?? { members: {}, palette: {} };
}

export function isExtendedVisualManual(visualManualId: string | undefined | null): boolean {
  return visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID;
}

/**
 * 给分镜帧生图 prompt 施加所选视觉手册的风格锁。
 * 扩展手册：先 sanitize 再幂等追加风格 token；其他风格或未选择：原样返回。
 */
export function withVisualManualStoryboardStyleTokens(
  prompt: string,
  visualManualId: string | undefined | null,
): string {
  const base = prompt.trim();
  if (!base || !isExtendedVisualManual(visualManualId)) return base;
  if (!EXTENDED_STORYBOARD_STYLE_TOKENS_SUFFIX) return base;
  const sanitized = sanitizeExtendedManualPrompt(base);
  const firstToken = EXTENDED_STORYBOARD_STYLE_TOKENS[0];
  if (firstToken && sanitized.includes(firstToken)) return sanitized;
  return `${sanitized}, ${EXTENDED_STORYBOARD_STYLE_TOKENS_SUFFIX}`;
}

/** 同 withVisualManualStoryboardStyleTokens，visualManualId 取当前 studio 项目工作流配置（非 React 上下文使用）。 */
export function withActiveVisualManualStoryboardStyleTokens(prompt: string): string {
  const visualManualId = useStudioStore.getState().workflowConfig.visualManualId;
  return withVisualManualStoryboardStyleTokens(prompt, visualManualId);
}

/** 当前手册为道劫时返回分镜帧风格指南，否则返回空字符串。 */
export function getActiveVisualManualStoryboardStyleGuide(): string {
  const visualManualId = useStudioStore.getState().workflowConfig.visualManualId;
  return isExtendedVisualManual(visualManualId) ? getExtendedStoryboardStyleGuide() : "";
}

/**
 * 道劫分镜帧传输编译:当前手册为道劫时,把分镜链已装配正文与手册帧负面编译为
 * ma-gongbi-v1 raw providerPrompt(唯一 Avoid+通用负面+300-800 长度门);
 * 非道劫返回 null(保持既有 enhanced 传输)。超 800 在网络前以可读错误拒绝。
 */
export async function compileActiveDaojieStoryboardFramePrompt(
  positive: string,
): Promise<CompiledDaojiePrompt | null> {
  if (!isExtendedVisualManual(useStudioStore.getState().workflowConfig.visualManualId)) return null;
  try {
    return await compileDaojieStoryboardFramePrompt({
      positive,
      negativeTerms: getExtendedStoryboardFrameNegative(),
    });
  } catch (err) {
    if (err instanceof DaojiePromptContractError && err.code === "length_exceeded") {
      throw new Error(`道劫提示词超出 800 字符 provider 上限（实际 ${err.input} 字符），已拒绝生成`);
    }
    throw err;
  }
}
