import type { SeriesBible } from "@/types/studio";

/** 角色锁定输入：优先 appearance，回退 description；voiceId 缺省 null。 */
export interface SeriesBibleCharacterInput {
  id: string;
  appearance?: string;
  description?: string;
  voiceId?: string | null;
}

export interface SeriesBibleSceneInput {
  name: string;
}

export interface BuildSeriesBibleInput {
  projectId: string;
  characters: SeriesBibleCharacterInput[];
  scenes: SeriesBibleSceneInput[];
  config: {
    visualManualId?: string;
    directorManualId?: string;
    platformSpec?: string;
    stylePositioning?: string;
  };
}

/** 竖屏短剧默认画幅（§全局规范）。platformSpec 缺省时回退。 */
const DEFAULT_ASPECT_RATIO = "9:16";

/**
 * 构建剧集圣经：一处锁定角色外貌+音色 / 场景 / 画风手册 / 画幅 / 风格定位，
 * 供 buildSkillContextPackage 在每次生成请求头部统一注入（§2.2 全局注入）。
 */
export function buildSeriesBible(input: BuildSeriesBibleInput): SeriesBible {
  const { projectId, characters, scenes, config } = input;
  return {
    id: `series-bible-${projectId}`,
    projectId,
    characterLocks: characters.map((character) => ({
      characterId: character.id,
      appearance: (character.appearance ?? character.description ?? "").trim(),
      voiceId: character.voiceId ?? null,
    })),
    sceneLocks: scenes.map((scene) => scene.name),
    visualManualId: config.visualManualId ?? "",
    directorManualId: config.directorManualId ?? "",
    aspectRatio: config.platformSpec?.trim() || DEFAULT_ASPECT_RATIO,
    stylePositioning: config.stylePositioning?.trim() ?? "",
  };
}

/** 渲染圣经摘要块；null → 空串，便于 context 注入处无脑拼接后跳过。 */
export function formatSeriesBibleSummary(bible: SeriesBible | null | undefined): string {
  if (!bible) return "";

  const characterLines = bible.characterLocks
    .filter((lock) => lock.appearance || lock.voiceId)
    .map((lock) => {
      const voice = lock.voiceId ? `（音色：${lock.voiceId}）` : "";
      return `- ${lock.characterId}：${lock.appearance}${voice}`;
    });

  return [
    "# 剧集圣经（全局锁定，所有生成请求须遵守）",
    `画幅：${bible.aspectRatio}`,
    bible.stylePositioning ? `风格定位：${bible.stylePositioning}` : "",
    bible.visualManualId ? `视觉手册：${bible.visualManualId}` : "",
    bible.directorManualId ? `导演手册：${bible.directorManualId}` : "",
    characterLines.length ? "角色外貌/音色锁定：" : "",
    ...characterLines,
    bible.sceneLocks.length ? `场景锁定：${bible.sceneLocks.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
