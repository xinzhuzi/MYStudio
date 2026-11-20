/**
 * 分镜素材自动绑定(10-11 pipeline-human-node-automation 批4,D2 真口径):
 * 分镜绑定不是表格赋值——资产图经关键帧管线产**受管路径**媒体,再
 * StoryboardItem.mediaRef + keyframes[0] 双写同源(I1 不变式,由
 * setStoryboardKeyframes 保证);帧路径走受管虚拟协议(I4:keyframes.ts
 * 既有校验复用,违反即例外清单不硬写)。
 * - 匹配(纯规则,无 AI):分镜条目的场景/角色名(associateAssetsNames)→
 *   asset-matching(名+别名+模糊);类型优先级=场景→角色→道具(与
 *   resolveStoryboardAssetReferences 的「场景在前」惯例同源);命中唯一=
 *   自动绑,多义/零命中=例外清单,缺图=先触发批2 补图再绑;
 * - 资产图复制进章节媒体库(workflow-images/{chapterId}/bindings/,不引用
 *   资产库原文件——资产图被替换/清理不得静默变更分镜画面);
 * - 就绪度计数:绑定经 setStoryboardKeyframes 落 mediaRef,分镜面板的
 *   「N 个画面」计数随 store 订阅自动更新;例外清单落
 *   useStoryboardBindingStore(批5 章验收卡同源消费)。
 */
import { toast } from "sonner";
import { create } from "zustand";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import {
  buildKeyframeId,
  normalizeStoryboardKeyframes,
  validateStoryboardKeyframes,
} from "@/lib/studio/keyframes";
import { storyboardBindingRelativePath, safePathSegment } from "@/lib/studio/chapter-paths";
import { saveImageToLocal } from "@/lib/media/image-storage";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardAssetBinding, StoryboardItem, StoryboardKeyframe } from "@/types/studio";
import { computeChapterScriptFingerprint, currentScriptFingerprintSnapshot } from "./chapter-pipeline-stale";
import { nameMatches, normalizeAssetText } from "./asset-matching";
import {
  buildChapterAssetRows,
  runChapterScriptAssetGeneration,
} from "./script-asset-batch";
import { getRowImage, type AssetGenerationType, type AssetRow } from "./script-asset-generation-model";

// ── 匹配(纯函数) ───────────────────────────────────────────────────────────

export type StoryboardBindingMatch =
  | { status: "unique"; row: AssetRow; image: string; unmatchedNames: string[] }
  | { status: "ambiguous"; type: AssetGenerationType; candidateNames: string[] }
  | { status: "missing-image"; row: AssetRow }
  | { status: "no-match" };

/** 匹配类型优先级:场景在前(建立镜头语感),角色次之,道具兜底。 */
const MATCH_TYPE_ORDER: readonly AssetGenerationType[] = ["scene", "character", "prop"];

/**
 * 1013 修 RC-6②:非精确命中名收集——names 中归一化后不等于任何行(全类型,
 * 角色行含 characterAliases 别名)的 name/别名归一值者;零命中与仅包含/模糊
 * 命中都算。精确命中自实现归一全等,不依赖 nameMatches(后者含包含语义)。
 */
function collectUnmatchedBindingNames(input: {
  names: string[];
  rows: AssetRow[];
  characterAliases?: Record<string, string[]>;
}): string[] {
  const exactKeys = new Set<string>();
  for (const row of input.rows) {
    exactKeys.add(normalizeAssetText(row.name));
    if (row.type === "character") {
      for (const alias of input.characterAliases?.[row.name] ?? []) {
        exactKeys.add(normalizeAssetText(alias));
      }
    }
  }
  return input.names.filter((name) => !exactKeys.has(normalizeAssetText(name)));
}

/**
 * 单镜匹配:shot.associateAssetsNames 逐名对章资产行做 名+别名+模糊 匹配
 * (asset-matching.nameMatches)。首个有命中的类型决定结果——该类型内
 * 多命中=多义(人拣,不猜);唯一命中但无图=缺图(触发补图);全类型零命中=
 * 零命中。确定性强:同输入同输出,无隐藏择优。
 */
export function matchStoryboardBindingAsset(input: {
  names: string[];
  rows: AssetRow[];
  /** 角色名 → 别名(实体提取批次口径)。 */
  characterAliases?: Record<string, string[]>;
}): StoryboardBindingMatch {
  const names = [...new Set((input.names ?? []).map((name) => name.trim()).filter(Boolean))];
  if (!names.length) return { status: "no-match" };
  for (const type of MATCH_TYPE_ORDER) {
    const hits = input.rows.filter(
      (row) =>
        row.type === type &&
        names.some((name) =>
          nameMatches(
            name,
            row.name,
            row.type === "character" ? input.characterAliases?.[row.name] ?? [] : [],
          ),
        ),
    );
    if (hits.length > 1) {
      return { status: "ambiguous", type, candidateNames: hits.map((row) => row.name) };
    }
    if (hits.length === 1) {
      const image = getRowImage(hits[0]);
      if (image) {
        return {
          status: "unique",
          row: hits[0],
          image,
          unmatchedNames: collectUnmatchedBindingNames({
            names,
            rows: input.rows,
            characterAliases: input.characterAliases,
          }),
        };
      }
      return { status: "missing-image", row: hits[0] };
    }
  }
  return { status: "no-match" };
}

/**
 * 1120 件一(镜级绑定契约):收集一镜**全部**命中资产行——不再「首个有命中的
 * 类型决定」,MATCH_TYPE_ORDER 全类型遍历,类型内按 rows 行序;匹配规则与
 * matchStoryboardBindingAsset 同源(nameMatches 名+别名+模糊,确定性别名表)。
 * 只收有图行(getRowImage 非空):slot 语义=参考图顺序,无图行无参考可言,
 * 缺图行补图后重绑即入列。与单命中语义并存不互扰:首帧绑定(keyframes[0])
 * 仍走 matchStoryboardBindingAsset,本函数只产 assetBindings 参考序。
 */
export function collectStoryboardAssetBindings(input: {
  names: string[];
  rows: AssetRow[];
  /** 角色名 → 别名(实体提取批次口径)。 */
  characterAliases?: Record<string, string[]>;
}): StoryboardAssetBinding[] {
  const names = [...new Set((input.names ?? []).map((name) => name.trim()).filter(Boolean))];
  if (!names.length) return [];
  const bindings: StoryboardAssetBinding[] = [];
  for (const type of MATCH_TYPE_ORDER) {
    for (const row of input.rows) {
      if (row.type !== type) continue;
      const hit = names.some((name) =>
        nameMatches(
          name,
          row.name,
          row.type === "character" ? input.characterAliases?.[row.name] ?? [] : [],
        ),
      );
      if (!hit || !getRowImage(row)) continue;
      bindings.push({ assetId: row.id, name: row.name, kind: row.type, slot: bindings.length + 1 });
    }
  }
  return bindings;
}

/**
 * 1120 件一读路单一口径:assetBindings 在档(非空)直接用;缺席(旧章)从
 * associateAssetsNames+资产行推导(collectStoryboardAssetBindings 同规则)。
 * 不改盘不迁移——推导结果仅供消费,重跑绑定才落档。
 */
export function resolveStoryboardAssetBindings(input: {
  shot: Pick<StoryboardItem, "assetBindings" | "associateAssetsNames">;
  rows: AssetRow[];
  characterAliases?: Record<string, string[]>;
}): StoryboardAssetBinding[] {
  if (input.shot.assetBindings?.length) return input.shot.assetBindings;
  return collectStoryboardAssetBindings({
    names: input.shot.associateAssetsNames ?? [],
    rows: input.rows,
    characterAliases: input.characterAliases,
  });
}

/** 发车校验失效明细(1120 件一):id 不可解析(行删)/id 漂移(重新提取)/行无图/
 * 阵容漂移(镜引用已换,绑定不再出自现镜阵容——1120 复核②)。 */
export interface StoryboardBindingShipInvalid {
  binding: StoryboardAssetBinding;
  reason: "unresolved" | "id-drift" | "no-image" | "lineup-drift";
}

/**
 * 在档绑定逐条核验(纯函数,1120 复核①②共用单源):①阵容先行——绑定名与现镜
 * associateAssetsNames(nameMatches 名+别名,与 collectStoryboardAssetBindings
 * 写路同规则)零匹配=阵容已换(分镜表重建旧绑定继承等),行可解析有图也失效;
 * ②行解析——id 可解析核行有图;id 不可解析 name 兜底双核:同名行在=重新提取
 * 换了 id(重跑绑定可愈),同名行也不在=行已删。发车校验与重跑绑定修复队列
 * 两消费方同源调用,口径禁分叉。
 */
export function findStoryboardBindingInvalidEntries(input: {
  bindings: StoryboardAssetBinding[];
  rows: AssetRow[];
  names: string[];
  characterAliases: Record<string, string[]>;
}): StoryboardBindingShipInvalid[] {
  const names = [...new Set((input.names ?? []).map((name) => name.trim()).filter(Boolean))];
  const rowById = new Map(input.rows.map((row) => [row.id, row]));
  const invalid: StoryboardBindingShipInvalid[] = [];
  for (const binding of input.bindings) {
    const inLineup = names.some((name) => nameMatches(
      name,
      binding.name,
      binding.kind === "character" ? input.characterAliases[binding.name] ?? [] : [],
    ));
    if (!inLineup) {
      invalid.push({ binding, reason: "lineup-drift" });
      continue;
    }
    const row = rowById.get(binding.assetId);
    if (row) {
      if (!getRowImage(row)) invalid.push({ binding, reason: "no-image" });
      continue;
    }
    const sameName = input.rows.find((row) => row.name === binding.name);
    invalid.push({ binding, reason: sameName ? "id-drift" : "unresolved" });
  }
  return invalid;
}

/**
 * 1120 件一发车校验:在档 assetBindings 逐条核验 assetId 可解析且行有图
 * (id+name 双核:name 冗余=失效判断兜底——重新提取可能换 id,行删与 id 漂移
 * 分开指路;阵容漂移同拒,禁「绑定已核」假象)。失效=抛错拒发+例外清单落行
 * (调用方走既有例外清单通道),禁静默。assetBindings 缺席(旧章)不拦:推导
 * 兼容路由消费方自取,推导条目出自现势行恒过校验,校验只对在档绑定契约有
 * 实效(防绑定后行删/图清/阵容换的时序漂移)。失效后的恢复路径=重跑绑定
 * (runStoryboardAssetBinding 修复队列重建契约,见该函数注释)。
 */
export function assertStoryboardAssetBindingsShippable(input: {
  shot: Pick<StoryboardItem, "id" | "index" | "episodeId" | "assetBindings" | "associateAssetsNames">;
  projectId: string | null;
}): void {
  const bindings = input.shot.assetBindings ?? [];
  if (!bindings.length) return;
  const rows = buildChapterAssetRows(input.shot.episodeId, input.projectId);
  const invalid = findStoryboardBindingInvalidEntries({
    bindings,
    rows,
    names: input.shot.associateAssetsNames ?? [],
    characterAliases: buildCharacterAliases(input.shot.episodeId),
  });
  if (!invalid.length) return;
  const details = invalid.map(({ binding, reason }) =>
    `${binding.name}(${reason === "unresolved" ? "资产行不存在" : reason === "id-drift" ? "资产行已重新提取，请重跑绑定" : reason === "lineup-drift" ? "镜阵容已变更，请重跑绑定" : "资产行无图"})`,
  );
  const label = `S${String(input.shot.index).padStart(2, "0")}`;
  // 例外清单落行(既有通道,禁重复建设):无 run 造最小报表容器,同镜复报=patch
  useStoryboardBindingStore.getState().appendExceptionRow(input.shot.episodeId, {
    storyboardId: input.shot.id,
    shotIndex: input.shot.index,
    status: "binding-invalid",
    statusLabel: EXCEPTION_STATUS_LABELS["binding-invalid"],
    detail: `${label} 绑定失效：${details.join("、")}`,
    matchedAssetName: invalid[0]!.binding.name,
  });
  throw new Error(`分镜绑定失效，已拒发：${details.join("、")}（例外清单见分镜面板，修复后重跑绑定）`);
}

// ── 绑定核心:资产图 → 关键帧管线受管路径 → I1 双写 ────────────────────────

export type StoryboardBindResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * 资产图复制进章节媒体库(受管路径)。项目内=projectFile 桥落
 * workflow-images/{chapterId}/bindings/{storyboardId}/;非项目环境回落本机
 * 媒体库 shots 分类。fail-closed:保存通道返回未持久化地址(http/data/blob/file)
 * 一律视为失败(1010 批0a 教训:禁静默拿原址当落盘)。
 */
async function copyAssetImageToChapterMedia(input: {
  chapterId: string;
  storyboardId: string;
  assetName: string;
  source: string;
  projectId: string | null;
}): Promise<{ ok: true; path: string; size: number } | { ok: false; reason: string }> {
  const filename = `${safePathSegment(input.assetName)}-${Date.now()}.png`;
  const projectFiles = input.projectId ? getProjectFilesBridge() : undefined;
  if (input.projectId && projectFiles?.saveImage) {
    const saved = await projectFiles.saveImage({
      projectId: input.projectId,
      relativePath: storyboardBindingRelativePath(
        input.chapterId,
        input.storyboardId,
        filename,
      ),
      source: input.source,
    });
    if (!saved.success || !saved.url) {
      return { ok: false, reason: saved.error || "项目内资产图复制失败" };
    }
    return { ok: true, path: saved.url, size: saved.size ?? 0 };
  }
  const savedPath = await saveImageToLocal(
    input.source,
    "shots",
    `${safePathSegment(input.storyboardId)}-${filename}`,
  );
  if (/^(?:https?:|data:|blob:|file:)/i.test(savedPath)) {
    return {
      ok: false,
      reason: `资产图复制进章节媒体库失败：保存通道返回未持久化地址 ${savedPath.slice(0, 48)}…`,
    };
  }
  return { ok: true, path: savedPath, size: 0 };
}

/**
 * 把资产图绑成指定分镜的首帧关键帧(storyboardId-kf-1,inUs=0):
 * 复制进章节媒体库 → 登记 material → keyframes.ts 既有校验(I4)→
 * setStoryboardKeyframes("backfill")(I1 首帧镜像=mediaRef 与 keyframes[0]
 * 双写同源;校验不过即例外,不硬写)。
 */
export async function bindAssetImageAsKeyframe(input: {
  storyboardId: string;
  asset: { type: AssetGenerationType; name: string; image: string };
  chapterId: string;
  projectId: string | null;
}): Promise<StoryboardBindResult> {
  const { storyboardId, asset } = input;
  const copied = await copyAssetImageToChapterMedia({
    chapterId: input.chapterId,
    storyboardId,
    assetName: asset.name,
    source: asset.image,
    projectId: input.projectId,
  });
  if (!copied.ok) return { ok: false, reason: copied.reason };

  // 章节媒体库登记(与分镜生图回写同款 material 台账)
  useStudioStore.getState().addMaterial({
    name: `${asset.name}（分镜绑定）`,
    localPath: copied.path,
    size: copied.size,
  });

  const mediaRef = { kind: "image" as const, path: copied.path };
  const live = useStudioStore.getState().storyboards.find((item) => item.id === storyboardId);
  // 多帧镜只补首帧槽(其余帧留帧规划器/生图管线),单帧镜构造 kf-1
  const frames: StoryboardKeyframe[] = live?.keyframes?.length
    ? live.keyframes.map((frame, index) => (index === 0 ? { ...frame, mediaRef } : frame))
    : [
        {
          frameId: buildKeyframeId(storyboardId, 1),
          mediaRef,
          inUs: 0,
          momentDescription: `资产绑定：${asset.name}`,
        },
      ];
  const normalized = normalizeStoryboardKeyframes(frames);
  // I4 等既有校验先行(keyframes.ts 复用):不过=例外清单,不硬写
  const issues = validateStoryboardKeyframes(normalized);
  if (issues.length) {
    return { ok: false, reason: `关键帧校验未过：${issues.join("；")}` };
  }
  try {
    useStudioStore.getState().setStoryboardKeyframes(storyboardId, normalized, "backfill");
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, path: copied.path };
}

// ── 就绪度判定(与分镜面板 mediaRef 计数同口径) ─────────────────────────────

/** 镜已有画面=video 落账 或 image mediaRef 或首帧关键帧有图;无=keyframes 空+无 mediaRef。 */
export function storyboardHasVisual(
  shot: Pick<StoryboardItem, "mediaRef" | "keyframes">,
): boolean {
  if (shot.mediaRef?.kind === "video") return true;
  if (shot.mediaRef?.kind === "image" && shot.mediaRef.path) return true;
  return Boolean(shot.keyframes?.[0]?.mediaRef?.path);
}

/** 镜已出视频=video mediaRef 落账(1120 件二验收主口径;与引擎 _video_url 同源
 *  判据=kind=video 且 path 可定位,图期=未就绪)。 */
export function storyboardHasVideo(
  shot: Pick<StoryboardItem, "mediaRef">,
): boolean {
  return shot.mediaRef?.kind === "video" && Boolean(shot.mediaRef.path);
}

// ── 批次态(例外清单=批5 章验收卡同源消费) ──────────────────────────────────

export type StoryboardBindingExceptionStatus =
  | "ambiguous"
  | "no-match"
  | "missing-image"
  | "failed"
  | "partial-match"
  /** 1120 件一:在档 assetBindings 发车校验失效(行删/id 漂移/行无图)。 */
  | "binding-invalid";

export interface StoryboardBindingExceptionRow {
  storyboardId: string;
  shotIndex: number;
  status: StoryboardBindingExceptionStatus;
  statusLabel: string;
  detail: string;
  /** 多义候选名(可点处理:人拣)。 */
  candidates?: string[];
  /** 缺图/失败时命中的资产名(重试锚)。 */
  matchedAssetName?: string;
  matchedAssetType?: AssetGenerationType;
}

export interface StoryboardBindingReport {
  chapterId: string;
  finishedAt: number;
  /** 参与绑定的未绑镜数。 */
  total: number;
  boundCount: number;
  /** 章就绪(有画面)镜数,绑前/绑后。 */
  readyBefore: number;
  readyAfter: number;
  /** 是否触发过批2 补图。 */
  fillTriggered: boolean;
  exceptions: StoryboardBindingExceptionRow[];
}

export interface StoryboardBindingRunView {
  chapterId: string;
  status: "running" | "done";
  progress: { done: number; total: number; currentShot: string };
  report?: StoryboardBindingReport;
}

interface StoryboardBindingState {
  runsByChapter: Record<string, StoryboardBindingRunView>;
  startRun: (chapterId: string, total: number) => void;
  updateProgress: (chapterId: string, done: number, total: number, currentShot: string) => void;
  finishRun: (chapterId: string, report: StoryboardBindingReport) => void;
  patchExceptionRow: (chapterId: string, storyboardId: string, patch: Partial<StoryboardBindingExceptionRow>) => void;
  removeExceptionRow: (chapterId: string, storyboardId: string) => void;
  /** 1120 件一:绑定批次外的失效披露落账(发车校验)——报表在档=同镜 patch/
   *  新行 append,无报表=造最小容器;不另建第二例外通道。 */
  appendExceptionRow: (chapterId: string, row: StoryboardBindingExceptionRow) => void;
  clearRun: (chapterId: string) => void;
}

export const useStoryboardBindingStore = create<StoryboardBindingState>()((set) => ({
  runsByChapter: {},
  startRun: (chapterId, total) =>
    set((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [chapterId]: {
          chapterId,
          status: "running",
          progress: { done: 0, total, currentShot: "" },
        },
      },
    })),
  updateProgress: (chapterId, done, total, currentShot) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run || run.status !== "running") return state;
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: { ...run, progress: { done, total, currentShot } },
        },
      };
    }),
  finishRun: (chapterId, report) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            ...(run ?? { chapterId, status: "running" as const, progress: { done: 0, total: 0, currentShot: "" } }),
            status: "done",
            report,
            progress: { done: report.total, total: report.total, currentShot: "" },
          },
        },
      };
    }),
  patchExceptionRow: (chapterId, storyboardId, patch) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run?.report) return state;
      const exceptions = run.report.exceptions.map((row) =>
        row.storyboardId === storyboardId ? { ...row, ...patch } : row,
      );
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            ...run,
            report: { ...run.report, exceptions },
          },
        },
      };
    }),
  removeExceptionRow: (chapterId, storyboardId) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run?.report) return state;
      const exceptions = run.report.exceptions.filter(
        (row) => row.storyboardId !== storyboardId,
      );
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            ...run,
            report: { ...run.report, exceptions },
          },
        },
      };
    }),
  appendExceptionRow: (chapterId, row) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run?.report) {
        // 该章未跑过绑定(发车校验先于绑定批次):造最小报表容器承载失效行
        return {
          runsByChapter: {
            ...state.runsByChapter,
            [chapterId]: {
              chapterId,
              status: "done" as const,
              progress: { done: 0, total: 0, currentShot: "" },
              report: {
                chapterId,
                finishedAt: Date.now(),
                total: 0,
                boundCount: 0,
                readyBefore: 0,
                readyAfter: 0,
                fillTriggered: false,
                exceptions: [row],
              },
            },
          },
        };
      }
      const exists = run.report.exceptions.some((item) => item.storyboardId === row.storyboardId);
      const exceptions = exists
        ? run.report.exceptions.map((item) =>
            item.storyboardId === row.storyboardId ? { ...item, ...row } : item,
          )
        : [...run.report.exceptions, row];
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: { ...run, report: { ...run.report, exceptions } },
        },
      };
    }),
  clearRun: (chapterId) =>
    set((state) => {
      if (!(chapterId in state.runsByChapter)) return state;
      const { [chapterId]: _removed, ...rest } = state.runsByChapter;
      return { runsByChapter: rest };
    }),
}));

const EXCEPTION_STATUS_LABELS: Record<StoryboardBindingExceptionStatus, string> = {
  ambiguous: "匹配多义",
  "no-match": "零命中",
  "missing-image": "缺图",
  failed: "绑定失败",
  "partial-match": "部分命中（已兜底）",
  "binding-invalid": "绑定失效",
};

// ── 章级编排 ───────────────────────────────────────────────────────────────

export interface RunStoryboardBindingInput {
  chapterId: string;
  projectId: string | null;
  visualManualId: string | undefined;
  /** 测试注入:替换批2 补图触发(缺省=真实 runChapterScriptAssetGeneration)。 */
  triggerAssetFill?: (input: RunStoryboardBindingInput) => Promise<unknown>;
}

interface ShotBindingOutcome {
  storyboardId: string;
  shotIndex: number;
  bound: boolean;
  exception?: StoryboardBindingExceptionRow;
}

function buildCharacterAliases(chapterId: string): Record<string, string[]> {
  const batch = useStudioStore
    .getState()
    .entityExtractions.find((item) => item.episodeId === chapterId);
  const aliases: Record<string, string[]> = {};
  for (const character of batch?.characters ?? []) {
    if (character.aliases?.length && !aliases[character.name]) {
      aliases[character.name] = character.aliases;
    }
  }
  return aliases;
}

/**
 * 提取集是否落后于现势剧本(G37/R7 补图过期门):比对提取批次盖戳
 * (EntityExtractionResult.scriptFingerprint)与现势剧本指纹
 * (computeChapterScriptFingerprint 同口径,scriptPlanSourceFingerprint
 * 零新造)。存量批次无戳=不比对(恒 fresh,兼容 G34 资产侧三处守卫同款口径)。
 */
function extractionBatchStale(chapterId: string): boolean {
  const batch = useStudioStore
    .getState()
    .entityExtractions.find((item) => item.episodeId === chapterId);
  if (!batch?.scriptFingerprint) return false;
  return (
    computeChapterScriptFingerprint(chapterId, currentScriptFingerprintSnapshot()) !==
    batch.scriptFingerprint
  );
}

/** 单镜匹配+绑定;缺图时先触发批2 补图再绑(fill 回调注入,默认真实批2)。 */
async function bindShotWithMatch(input: {
  shot: StoryboardItem;
  rows: AssetRow[];
  characterAliases: Record<string, string[]>;
  chain: RunStoryboardBindingInput;
  /** 缺图时是否允许触发批2 补图(批二轮扫描时禁:已补过)。 */
  allowFill: boolean;
  fillTriggered: () => void;
}): Promise<ShotBindingOutcome> {
  const { shot, rows, characterAliases, chain } = input;
  const label = `S${String(shot.index).padStart(2, "0")}`;
  const match = matchStoryboardBindingAsset({
    names: shot.associateAssetsNames ?? [],
    rows,
    characterAliases,
  });

  if (match.status === "no-match") {
    return {
      storyboardId: shot.id,
      shotIndex: shot.index,
      bound: false,
      exception: {
        storyboardId: shot.id,
        shotIndex: shot.index,
        status: "no-match",
        statusLabel: EXCEPTION_STATUS_LABELS["no-match"],
        detail: `引用资产（${(shot.associateAssetsNames ?? []).join("、") || "无"}）在章资产清单零命中`,
      },
    };
  }
  if (match.status === "ambiguous") {
    return {
      storyboardId: shot.id,
      shotIndex: shot.index,
      bound: false,
      exception: {
        storyboardId: shot.id,
        shotIndex: shot.index,
        status: "ambiguous",
        statusLabel: EXCEPTION_STATUS_LABELS.ambiguous,
        detail: `${label} 命中多个${match.type === "scene" ? "场景" : match.type === "character" ? "角色" : "道具"}资产，请人工拣选`,
        candidates: match.candidateNames,
      },
    };
  }

  if (match.status === "missing-image") {
    // 缺图=先触发批2 补图再绑(PRD R3);补完重读行现势复配
    if (input.allowFill && chain.visualManualId && chain.projectId) {
      // G37/R7 补图过期门:fill 触发前比对提取批次盖戳 vs 现势剧本指纹
      // (computeChapterScriptFingerprint 同口径)。错位=按旧提取集补图=静默烧图
      // ——该行以 failed+原因落账(镜像绑定失败模式),fill 不发(不烧图)、
      // 直接返回不阻断其余行;存量批次无戳=不比对(extractionBatchStale 恒 false)
      if (extractionBatchStale(chain.chapterId)) {
        return {
          storyboardId: shot.id,
          shotIndex: shot.index,
          bound: false,
          exception: {
            storyboardId: shot.id,
            shotIndex: shot.index,
            status: "failed",
            statusLabel: EXCEPTION_STATUS_LABELS.failed,
            detail: "提取集过期，请先重新提取资产",
            matchedAssetName: match.row.name,
            matchedAssetType: match.row.type,
          },
        };
      }
      input.fillTriggered();
      const fill = chain.triggerAssetFill ?? runChapterScriptAssetGeneration;
      try {
        await fill({
          chapterId: chain.chapterId,
          projectId: chain.projectId,
          visualManualId: chain.visualManualId,
        });
      } catch (error) {
        return {
          storyboardId: shot.id,
          shotIndex: shot.index,
          bound: false,
          exception: {
            storyboardId: shot.id,
            shotIndex: shot.index,
            status: "missing-image",
            statusLabel: EXCEPTION_STATUS_LABELS["missing-image"],
            detail: `补图触发失败：${error instanceof Error ? error.message : String(error)}`,
            matchedAssetName: match.row.name,
            matchedAssetType: match.row.type,
          },
        };
      }
    }
    const freshRows = buildChapterAssetRows(chain.chapterId, chain.projectId);
    const freshMatch = matchStoryboardBindingAsset({
      names: shot.associateAssetsNames ?? [],
      rows: freshRows,
      characterAliases,
    });
    if (freshMatch.status === "unique") {
      return bindUniqueMatch({
        shot,
        match: freshMatch,
        chain,
        rows: freshRows,
        characterAliases,
        unmatchedNames: freshMatch.unmatchedNames,
      });
    }
    const canFill = Boolean(chain.visualManualId && chain.projectId);
    return {
      storyboardId: shot.id,
      shotIndex: shot.index,
      bound: false,
      exception: {
        storyboardId: shot.id,
        shotIndex: shot.index,
        status:
          freshMatch.status === "ambiguous"
            ? "ambiguous"
            : freshMatch.status === "no-match"
              ? "no-match"
              : "missing-image",
        statusLabel:
          freshMatch.status === "ambiguous"
            ? EXCEPTION_STATUS_LABELS.ambiguous
            : freshMatch.status === "no-match"
              ? EXCEPTION_STATUS_LABELS["no-match"]
              : EXCEPTION_STATUS_LABELS["missing-image"],
        detail:
          freshMatch.status === "missing-image"
            ? canFill
              ? `命中「${freshMatch.row.name}」但补图后仍无图`
              : `命中「${match.row.name}」缺图，且未选视觉手册/项目无法补图`
            : `命中「${match.row.name}」缺图，补图后复配${freshMatch.status === "ambiguous" ? "变多义" : "零命中"}`,
        candidates: freshMatch.status === "ambiguous" ? freshMatch.candidateNames : undefined,
        matchedAssetName:
          freshMatch.status === "missing-image" ? freshMatch.row.name : match.row.name,
        matchedAssetType: match.row.type,
      },
    };
  }

  return bindUniqueMatch({
    shot,
    match,
    chain,
    rows,
    characterAliases,
    unmatchedNames: match.unmatchedNames,
  });
}

async function bindUniqueMatch(input: {
  shot: StoryboardItem;
  match: Extract<StoryboardBindingMatch, { status: "unique" }>;
  chain: RunStoryboardBindingInput;
  /** 1120 件一:绑定行集(收集 assetBindings 用;补图路径传 freshRows 现势)。 */
  rows: AssetRow[];
  characterAliases: Record<string, string[]>;
  /** 1013 修 RC-6④:非精确命中名(可选)——非空=绑定成立但仍需例外披露。 */
  unmatchedNames?: string[];
}): Promise<ShotBindingOutcome> {
  const { shot, match, chain } = input;
  const result = await bindAssetImageAsKeyframe({
    storyboardId: shot.id,
    asset: { type: match.row.type, name: match.row.name, image: match.image },
    chapterId: chain.chapterId,
    projectId: chain.projectId,
  });
  if (!result.ok) {
    return {
      storyboardId: shot.id,
      shotIndex: shot.index,
      bound: false,
      exception: {
        storyboardId: shot.id,
        shotIndex: shot.index,
        status: "failed",
        statusLabel: EXCEPTION_STATUS_LABELS.failed,
        detail: result.reason,
        matchedAssetName: match.row.name,
        matchedAssetType: match.row.type,
      },
    };
  }
  // 1120 件一:镜级绑定契约——首帧绑定成功外,全量有图命中行按 场景→角色→道具
  // 与行序落 assetBindings(参考序;与 keyframes[0] 单命中双轨并存)。行集非空
  // 才写(行集空=绑定批次外注入,跳过不误清在档绑定)。
  const bindings = collectStoryboardAssetBindings({
    names: shot.associateAssetsNames ?? [],
    rows: input.rows,
    characterAliases: input.characterAliases,
  });
  if (bindings.length) {
    useStudioStore.getState().updateStoryboard(shot.id, { assetBindings: bindings });
  }
  if (input.unmatchedNames?.length) {
    // 1013 修 RC-6④:兜底绑定成立但引用未精确命中——同收 partial-match 例外行
    // (披露不静默;boundCount 计入、章卡「需人工」计数排除,见 chapter-pipeline)
    return {
      storyboardId: shot.id,
      shotIndex: shot.index,
      bound: true,
      exception: {
        storyboardId: shot.id,
        shotIndex: shot.index,
        status: "partial-match",
        statusLabel: EXCEPTION_STATUS_LABELS["partial-match"],
        detail: `引用（${input.unmatchedNames.join("、")}）未精确命中章资产行，已用「${match.row.name}」兜底绑定`,
        matchedAssetName: match.row.name,
        matchedAssetType: match.row.type,
      },
    };
  }
  return { storyboardId: shot.id, shotIndex: shot.index, bound: true };
}

/**
 * 章级自动绑定入口:遍历本章未绑镜(有画面/video 的跳过)→ 匹配→绑定→
 * 缺图触发批2 补图→ 二轮复配。例外清单+就绪度计数落
 * useStoryboardBindingStore(批5 验收卡消费);返回跑完报表。
 * 1120 复核①修复队列:「修复后重跑绑定」对有画面镜可达——id 漂移/行删后,
 * 有画面镜(绑定成功过恒有画面)不在 pending 面(原 pending=无画面镜过滤),
 * 重跑绑定原样跳过=镜不可发车且无 UI 恢复路径(assetBindings 唯一写点
 * bindShotWithMatch 对有画面镜不可达)。现补第二队列:有画面但绑定契约失效
 * (lineup-drift/id-drift/unresolved)的镜按现势行集+现镜阵容重建
 * assetBindings(findStoryboardBindingInvalidEntries 同源判定);行删条目随
 * 重建自然剔除。no-image 不在重建面(行补图即愈,绑定契约本身有效)。
 */
export async function runStoryboardAssetBinding(
  input: RunStoryboardBindingInput,
): Promise<StoryboardBindingReport | null> {
  const { chapterId, projectId } = input;
  const bindingStore = useStoryboardBindingStore.getState();
  const running = bindingStore.runsByChapter[chapterId];
  if (running?.status === "running") {
    toast.info("分镜素材绑定进行中，已并入在途批次");
    return null;
  }
  const state = useStudioStore.getState();
  const shots = state.storyboards
    .filter((item) => item.episodeId === chapterId)
    .sort((left, right) => left.index - right.index);
  if (!shots.length) {
    toast.error("本章尚无分镜：请先生成分镜表");
    return null;
  }
  const rows = buildChapterAssetRows(chapterId, projectId);
  const characterAliases = buildCharacterAliases(chapterId);
  const pending = shots.filter((shot) => !storyboardHasVisual(shot));
  // 修复队列(1120 复核①):有画面但绑定契约失效的镜(同源判定见上注)。
  const drifted = shots.filter((shot) => {
    if (!storyboardHasVisual(shot) || !shot.assetBindings?.length) return false;
    return findStoryboardBindingInvalidEntries({
      bindings: shot.assetBindings,
      rows,
      names: shot.associateAssetsNames ?? [],
      characterAliases,
    }).some((entry) => entry.reason !== "no-image");
  });
  if (!pending.length && !drifted.length) {
    toast.info(`本章 ${shots.length} 镜均已有画面，无需绑定`);
    return null;
  }
  if (!rows.length) {
    toast.error("本章提取批次没有资产行：请先在「剧本资产管理」完成资产提取");
    return null;
  }
  const readyBefore = shots.filter(storyboardHasVisual).length;
  const toastId = `storyboard-binding:${chapterId}`;
  useStoryboardBindingStore.getState().startRun(chapterId, pending.length + drifted.length);
  toast.loading(`分镜素材绑定发车：${pending.length} 镜待绑${drifted.length ? ` · ${drifted.length} 镜重建绑定` : ""}`, { id: toastId });

  const exceptions: StoryboardBindingExceptionRow[] = [];
  let boundCount = 0;
  let fillTriggered = false;
  let loopError: unknown = null;
  // 缺图补发只许一轮(首轮遇缺图触发批2 后,同轮后续镜直接复配新图;
  // 二轮起禁再触发——防多镜缺图反复发批)
  let fillUsed = false;
  let done = 0;
  const totalTargets = pending.length + drifted.length;

  try {
    for (const shot of pending) {
      useStoryboardBindingStore
        .getState()
        .updateProgress(chapterId, done, totalTargets, `S${String(shot.index).padStart(2, "0")}`);
      const outcome = await bindShotWithMatch({
        shot,
        rows: buildChapterAssetRows(chapterId, projectId),
        characterAliases,
        chain: input,
        allowFill: !fillUsed,
        fillTriggered: () => {
          fillTriggered = true;
          fillUsed = true;
        },
      });
      if (outcome.bound) boundCount += 1;
      if (outcome.exception) exceptions.push(outcome.exception);
      done += 1;
      useStoryboardBindingStore.getState().updateProgress(chapterId, done, totalTargets, "");
    }
    // 修复队列(1120 复核①):重建失效绑定契约——pending 轮在前,补图(批2)
    // 产出的新图行可被重建吸收;行集/行别名逐镜现读(与 pending 轮同口径)。
    for (const shot of drifted) {
      const label = `S${String(shot.index).padStart(2, "0")}`;
      const live = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
      if (!live) continue;
      const rebuilt = collectStoryboardAssetBindings({
        names: live.associateAssetsNames ?? [],
        rows: buildChapterAssetRows(chapterId, projectId),
        characterAliases: buildCharacterAliases(chapterId),
      });
      // 空集=阵容行全失/全无图:清空在档契约(校验跳过,读路按名推导)。
      useStudioStore.getState().updateStoryboard(live.id, { assetBindings: rebuilt });
      useStoryboardBindingStore.getState().removeExceptionRow(chapterId, live.id);
      boundCount += 1;
      done += 1;
      useStoryboardBindingStore.getState().updateProgress(chapterId, done, totalTargets, label);
    }
  } catch (error) {
    // 绑定单镜已自收口;此处兜编排层异常,批次必须收终态(防重入不中毒)
    loopError = error;
  }

  const freshShots = useStudioStore
    .getState()
    .storyboards.filter((item) => item.episodeId === chapterId);
  const readyAfter = freshShots.filter(storyboardHasVisual).length;
  const report: StoryboardBindingReport = {
    chapterId,
    finishedAt: Date.now(),
    total: totalTargets,
    boundCount,
    readyBefore,
    readyAfter,
    fillTriggered,
    exceptions,
  };
  useStoryboardBindingStore.getState().finishRun(chapterId, report);

  if (loopError) {
    toast.error(
      `分镜绑定中断：${loopError instanceof Error ? loopError.message : String(loopError)}（已绑 ${boundCount}/${totalTargets}，例外清单见分镜面板）`,
      { id: toastId },
    );
    return report;
  }

  const summary = `分镜素材绑定完成：绑 ${boundCount}/${totalTargets} · 就绪 ${readyAfter}/${freshShots.length}`;
  const descriptionParts = [
    fillTriggered ? "已触发本章资产补图" : null,
    exceptions.length
      ? `例外 ${exceptions.length}：${exceptions
          .map((row) => `S${String(row.shotIndex).padStart(2, "0")} ${row.statusLabel}`)
          .join("、")}`
      : null,
  ].filter(Boolean);
  if (exceptions.length) {
    toast.warning(summary, { id: toastId, description: descriptionParts.join("\n") });
  } else {
    toast.success(summary, { id: toastId, description: descriptionParts.join("\n") });
  }
  return report;
}

// ── 例外单镜重试(可点处理) ─────────────────────────────────────────────────

/**
 * 例外单镜重试:重走匹配+绑定(缺图类会再触发批2 补图,幂等)。成功=例外行
 * 摘除;失败=detail 更新。多义类重试无意义(需人拣),直接提示。
 */
export async function retryStoryboardBindingShot(input: {
  chapterId: string;
  projectId: string | null;
  visualManualId: string | undefined;
  storyboardId: string;
}): Promise<void> {
  const run = useStoryboardBindingStore.getState().runsByChapter[input.chapterId];
  const exception = run?.report?.exceptions.find(
    (row) => row.storyboardId === input.storyboardId,
  );
  if (exception?.status === "ambiguous") {
    toast.info(
      `S${String(exception.shotIndex).padStart(2, "0")} 为多义命中（${exception.candidates?.join("、")}），请到资产库人工处理名称歧义后重试`,
    );
    return;
  }
  const shot = useStudioStore.getState().storyboards.find(
    (item) => item.id === input.storyboardId,
  );
  if (!shot) {
    toast.error("分镜不存在（可能已被分镜表重建替换），请重跑本章绑定");
    return;
  }
  const label = `S${String(shot.index).padStart(2, "0")}`;
  const toastId = `storyboard-binding-retry:${input.storyboardId}`;
  toast.loading(`正在重绑 ${label} ...`, { id: toastId });
  const outcome = await bindShotWithMatch({
    shot,
    rows: buildChapterAssetRows(input.chapterId, input.projectId),
    characterAliases: buildCharacterAliases(input.chapterId),
    chain: input,
    allowFill: true,
    fillTriggered: () => undefined,
  });
  if (outcome.bound) {
    if (outcome.exception) {
      // 1013 修 RC-6⑤:兜底重绑成功但仍有非精确命中——partial 行回写保留
      // (披露不摘除),与首跑同款例外清单形态
      useStoryboardBindingStore.getState().patchExceptionRow(
        input.chapterId,
        input.storyboardId,
        { ...outcome.exception, storyboardId: input.storyboardId, shotIndex: shot.index },
      );
      toast.warning(`${label} 重绑成功（兜底）：${outcome.exception.detail}`, { id: toastId });
      return;
    }
    // 例外行摘除+就绪度随 store 订阅自动更新(绑定的 mediaRef 已落账)
    useStoryboardBindingStore.getState().removeExceptionRow(input.chapterId, input.storyboardId);
    toast.success(`${label} 重绑成功`, { id: toastId });
    return;
  }
  if (outcome.exception) {
    useStoryboardBindingStore.getState().patchExceptionRow(
      input.chapterId,
      input.storyboardId,
      { ...outcome.exception, storyboardId: input.storyboardId, shotIndex: shot.index },
    );
    toast.error(`${label} 重绑失败：${outcome.exception.detail}`, { id: toastId });
  }
}
