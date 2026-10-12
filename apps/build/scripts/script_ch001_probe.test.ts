import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildScriptManualContext } from "@/lib/studio/manuals";
import { formatSourceBibleContext } from "@/lib/studio/source-bible";
import {
  buildProjectMemoryRecords,
  formatProjectMemoryContext,
  retrieveProjectMemory,
} from "@/lib/studio/project-memory";
import { buildStageMessages } from "@/lib/studio/script-planning";
import type { NovelChapter } from "@/types/studio";

/**
 * ch001 两腿探针·腿1(R6/G16/G21):不出网,读本机项目库 chapter-001 → buildStageMessages →
 * prompt dump 落本任务 research/(gitignored,ch001 原文不进仓库)。
 * env 门控:SCRIPT_CH001_STORE=<项目库路径>(如 /Users/zhengbingjin/Project/IP/MA/store/studio-workflow)
 * 时才跑;常规 vitest(不设 env)整组 skip——不污染常规门禁。
 *
 * 同源口径(1012 评审修正):prompt 组装对齐生产链 useScriptStageActions.buildStageMessagesFull——
 * - workflowConfig 真值取自库内 core-*.json(小说类型/画幅/时长/两手册 id),不再硬编码;
 * - manualContext 按 hook scriptStyleSummary 公式复刻(useScriptStageActions.ts 同字段同序),
 *   目标画风名取共享存储装机 README 首行(dev/装机同库,与 viewModel catalog 同源);
 * - originalBibleContext=生产同款真源:项目根 novel/source-memory/MEMORY.md
 *   (source-memory.ts readResidentBible 同路径,缺失=""绝不回退——store 副本 core.state.sourceBible
 *   为旧版快照,主角别名等称谓事实已与 MEMORY.md 分叉,按 G12 称谓规范不可用旧版);
 * - eventMemoryContext=生产同款 project-memory 三函数管线(store 章节数据/提取批次/系列圣经);
 * - 仍非同源项(如实记录):项目名(生产=useProjectStore activeProject.name,探针无项目库入口,
 *   以项目目录名代)、原著档案检索(生产经 electron bridge 异步检索,探针不出网省略)、
 *   导演偏好块 formatDirectorPreferenceContext(共享存储暂无该文件,当前零分叉;实弹前用户
 *   若在 UI 设偏好,生产将多此块)、catalog 双源(directorContext 正文=仓库种子 catalog,
 *   画风名=共享存储装机 README;生产两者均共享存储 catalog,存储副本受保护可被用户改)。
 * 章节数据形态(Phase 0 P1 已核):chapters/chapter-001/novel-chapters-001-*.json
 * → { state: { novelChapters: [ { title, sourceText, eventSummary, eventState, … } ] }, version }。
 */
const STORE = process.env.SCRIPT_CH001_STORE;
// import.meta.url 定位(同目录 heap-profiler-interactions.test.ts:22 先例),不依赖 vitest cwd:
// 本文件住 apps/build/scripts/ → 上三级=仓库根 → .trellis/tasks/…/research
const RESEARCH_DIR = fileURLToPath(
  new URL("../../../.trellis/tasks/10-11-script-gen-chain-fixes/research", import.meta.url),
);

interface CoreState {
  workflowConfig: {
    directorManualId?: string;
    visualManualId?: string;
    platformSpec?: string;
    novelGenre?: string;
    stylePositioning?: string;
    episodeCount?: number;
    episodeDurationMin?: number;
  };
  sourceBible: string;
  seriesBible: { projectId?: string } & Record<string, unknown>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function findFile(dir: string, pattern: RegExp): string {
  const file = readdirSync(dir).find((name) => pattern.test(name));
  if (!file) throw new Error(`file not found under ${dir} (pattern ${pattern})`);
  return resolve(dir, file);
}

function loadCh001(store: string): NovelChapter {
  const file = findFile(resolve(store, "chapters/chapter-001"), /^novel-chapters-001-.*\.json$/);
  const raw = readJson(file) as {
    state?: { novelChapters?: Array<Record<string, unknown>> };
  };
  const chapter = raw.state?.novelChapters?.[0];
  if (!chapter || typeof chapter.sourceText !== "string" || !chapter.sourceText.trim()) {
    throw new Error("chapter.sourceText missing/empty");
  }
  return chapter as unknown as NovelChapter;
}

function loadCore(store: string): CoreState {
  const file = findFile(store, /^core-.*\.json$/);
  const raw = readJson(file) as { state?: CoreState };
  const state = raw.state;
  if (!state?.workflowConfig) throw new Error("core state.workflowConfig missing");
  return state;
}

function loadEntityExtractions(store: string) {
  const file = findFile(resolve(store, "chapters/chapter-001"), /^entity-extractions-001-.*\.json$/);
  const raw = readJson(file) as { state?: { entityExtractions?: unknown[] } };
  return (raw.state?.entityExtractions ?? []) as never[];
}

/** 目标画风名:共享存储装机 README 首个非空行,复刻 manuals.ts getManualName 剥离规则。 */
function installedVisualManualName(visualManualId: string): string | null {
  if (!visualManualId) return null;
  try {
    const readme = readFileSync(
      resolve(
        homedir(),
        "Library/Application Support/漫影工作室/skills/art_skills",
        visualManualId,
        "README.md",
      ),
      "utf8",
    );
    const firstLine = readme.split(/\r?\n/).find((line) => line.trim());
    const name = firstLine?.replace(/^#+\s*/, "").replace(/--/g, "").trim();
    return name || null;
  } catch {
    return null;
  }
}

/** scriptStyleSummary 公式复刻(useScriptStageActions.ts 同字段同序;项目名除外,见文件头注释)。 */
function buildStyleSummary(input: {
  projectName: string;
  visualName: string | null;
  novelGenre?: string;
  stylePositioning?: string;
  platformSpec?: string;
  episodeCount?: number;
  episodeDurationMin?: number;
  novelChapterCount: number;
}): string {
  return [
    "## 项目信息",
    `小说名称：${input.projectName}`,
    input.novelGenre ? `小说类型：${input.novelGenre}` : "",
    `目标画风：${input.visualName || input.stylePositioning || "未设"}`,
    `目标画幅：${input.platformSpec || "16:9"}`,
    input.episodeCount ? `集数：${input.episodeCount}集` : "",
    `单集参考时长：${input.episodeDurationMin ?? 3}分钟`,
    `章节数量：${input.novelChapterCount}章`,
  ]
    .filter(Boolean)
    .join("\n");
}

describe.skipIf(!STORE)("script ch001 probe leg1: prompt dump (offline)", () => {
  it("scriptDraft prompt carries adaptation method doc + 题材剧本规则, no visual/director manual sections", () => {
    // 只读用户项目库(G16);产物只落任务 research/(原文不进仓库)
    const store = STORE!;
    const chapter = loadCh001(store);
    const core = loadCore(store);
    const config = core.workflowConfig;
    const novelChapterCount = readdirSync(resolve(store, "chapters")).length;

    // 种子 catalog(assets 真源):道劫包 script_narrative(v3 已建文件 + Phase 3 已登记键)
    const directorContext = buildScriptManualContext({
      directorManualId: config.directorManualId,
    });
    expect(directorContext.length).toBeGreaterThan(0);
    expect(directorContext).toContain("## 题材剧本规则（");

    // 生产同款上下文(hook buildStageMessagesFull 口径)
    const projectId = core.seriesBible?.projectId ?? "studio-current-project";
    const eventMemoryContext = formatProjectMemoryContext(
      retrieveProjectMemory({
        records: buildProjectMemoryRecords({
          projectId,
          chapters: [chapter],
          entityExtractions: loadEntityExtractions(store),
          seriesBible: core.seriesBible as never,
        }),
        projectId,
        episodeId: chapter.id,
        query: `${chapter.title} ${chapter.eventSummary ?? ""} ${chapter.eventState ?? ""}`,
      }),
    );
    // 生产同款真源:项目根 novel/source-memory/MEMORY.md(store 上两级=项目根);
    // 缺失=""不回退 store 副本(与 readResidentBible「绝不回退旧文件或 store」同口径)
    const biblePath = resolve(store, "../../novel/source-memory/MEMORY.md");
    const originalBibleContext = formatSourceBibleContext(
      existsSync(biblePath) ? readFileSync(biblePath, "utf8") : "",
    );
    expect(originalBibleContext).toContain("原著圣经");

    // 重生成场景(R1/G8 修复后):有原文、非修订 → novel_adaptation,system 含改编方法文档
    const messages = buildStageMessages("scriptDraft", {
      manualContext: buildStyleSummary({
        projectName: "MA",
        visualName: installedVisualManualName(config.visualManualId ?? ""),
        novelGenre: config.novelGenre,
        stylePositioning: config.stylePositioning,
        platformSpec: config.platformSpec,
        episodeCount: config.episodeCount,
        episodeDurationMin: config.episodeDurationMin,
        novelChapterCount,
      }),
      directorContext,
      originalBibleContext,
      eventMemoryContext,
      chapterTitle: chapter.title,
      chapterText: chapter.sourceText,
      eventState: chapter.eventState,
    });

    expect(messages.system).toContain("剧本改编方法：小说转短剧的取舍思考");
    expect(messages.user).toContain("## 题材剧本规则（");
    expect(messages.user).toContain("原著圣经");
    expect(messages.user).not.toContain("# 视觉手册");
    expect(messages.user).not.toContain("# 导演手册");
    expect(messages.user).not.toContain("导演手法参考");

    mkdirSync(RESEARCH_DIR, { recursive: true });
    writeFileSync(
      resolve(RESEARCH_DIR, "ch001-prompt-post.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          store,
          workflowConfig: config,
          system: messages.system,
          user: messages.user,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  });
});
