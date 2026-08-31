import {
  parseStoryboardTable,
  type StoryboardTableRow,
} from "@/lib/studio/storyboard-table";

/**
 * 按场分段导出(Remotion 工作流)——场结构与帧分区的纯函数层。
 *
 * 场结构唯一可信源:agentWorkData 里的分镜表原文(`## 场N` 场头)。
 * `parseStoryboardTable` 已解析出 `row.sceneIndex/scene`,只是
 * `toStoryboardItems` 落库时丢弃——这里从原文重新推导,不依赖 store
 * 分镜携带场字段(B 期 schema 强化前的口径)。
 */

export interface SceneSegmentStoryboardRef {
  id: string;
  index: number;
  duration?: number;
}

export interface SceneStoryboardGroup {
  sceneNo: number;
  sceneName: string;
  storyboardIds: string[];
  shotCount: number;
  durationSeconds?: number;
}

export type DeriveSceneGroupsResult =
  | { success: true; scenes: SceneStoryboardGroup[] }
  | { success: false; error: string };

export const SCENE_STRUCTURE_LOST_MESSAGE =
  "分镜表场结构已丢失（表格缺少「## 场N」场头，常见于 JSON 编辑器回写），请重新生成分镜表后再按场分段导出";

/**
 * 从分镜表原文 + 当前面板分镜推导场分组。
 *
 * 行按出现顺序聚合成「场运行段」：有 sceneIndex 的按场号切；legacy 行
 * （sceneIndex 由场景名首现编号派生）同样命中。场号必须随行序递增；行与
 * 面板分镜按 index 一一对齐，数量不一致即报错。
 */
export function deriveSceneGroups(
  tableText: string,
  storyboards: readonly SceneSegmentStoryboardRef[],
): DeriveSceneGroupsResult {
  const parsed = parseStoryboardTable(tableText, "");
  if (parsed.errors.length > 0) {
    return { success: false, error: `分镜表解析失败：${parsed.errors.slice(0, 3).join("；")}` };
  }
  const rows = parsed.rows;
  if (rows.length === 0) return { success: false, error: "分镜表为空，无法按场分段" };

  const runs = groupRowsIntoSceneRuns(rows);
  if (runs.length === 0) return { success: false, error: SCENE_STRUCTURE_LOST_MESSAGE };

  const storyboardByIndex = new Map<number, SceneSegmentStoryboardRef>();
  for (const storyboard of storyboards) {
    if (storyboardByIndex.has(storyboard.index)) {
      return { success: false, error: `面板分镜序号重复：${storyboard.index}` };
    }
    storyboardByIndex.set(storyboard.index, storyboard);
  }
  if (storyboardByIndex.size !== rows.length) {
    return {
      success: false,
      error: `分镜表与面板分镜不一致（表 ${rows.length} 行 / 面板 ${storyboardByIndex.size} 条），请重新生成分镜表`,
    };
  }

  const scenes: SceneStoryboardGroup[] = [];
  for (const run of runs) {
    const storyboardIds: string[] = [];
    let durationSeconds = 0;
    let hasDuration = true;
    for (const row of run.rows) {
      const storyboard = storyboardByIndex.get(row.index);
      if (!storyboard) {
        return { success: false, error: `分镜表第 ${row.index} 镜在面板中不存在，请重新生成分镜表` };
      }
      storyboardIds.push(storyboard.id);
      if (typeof storyboard.duration === "number" && Number.isFinite(storyboard.duration)) {
        durationSeconds += storyboard.duration;
      } else {
        hasDuration = false;
      }
    }
    scenes.push({
      sceneNo: run.sceneNo,
      sceneName: run.sceneName,
      storyboardIds,
      shotCount: run.rows.length,
      ...(hasDuration ? { durationSeconds } : {}),
    });
  }
  return { success: true, scenes };
}

interface SceneRowRun {
  sceneNo: number;
  sceneName: string;
  rows: StoryboardTableRow[];
}

function groupRowsIntoSceneRuns(rows: readonly StoryboardTableRow[]): SceneRowRun[] {
  const runs: SceneRowRun[] = [];
  let previousKey: string | undefined;
  let previousSceneIndex: number | undefined;
  let fallbackSceneNo = 0;
  for (const row of rows) {
    const sceneIndex = row.sceneIndex;
    if (sceneIndex === undefined && !row.scene) return [];
    const key = sceneIndex !== undefined ? `#${sceneIndex}` : `@${row.scene}`;
    if (key === previousKey) {
      runs[runs.length - 1]!.rows.push(row);
      continue;
    }
    let sceneNo: number;
    if (sceneIndex !== undefined) {
      // 场号必须随行序递增：legacy 15 列表同名场交错出现会在此暴露为不可分段。
      if (previousSceneIndex !== undefined && sceneIndex <= previousSceneIndex) return [];
      sceneNo = sceneIndex;
      previousSceneIndex = sceneIndex;
    } else {
      if (previousSceneIndex !== undefined) return [];
      fallbackSceneNo += 1;
      sceneNo = fallbackSceneNo;
    }
    runs.push({ sceneNo, sceneName: row.scene, rows: [row] });
    previousKey = key;
  }
  return runs;
}

/** 已经过 `layoutVisualTimeline` 摆位的视觉片段（帧轴绝对时序）。 */
export interface SceneSegmentClipTiming {
  clipId: string;
  storyboardId: string;
  from: number;
  durationInFrames: number;
}

export interface SceneSegmentSceneInput {
  sceneNo: number;
  sceneName: string;
  storyboardIds: readonly string[];
}

export interface SceneSegmentFramePlan {
  sceneNo: number;
  sceneName: string;
  storyboardIds: string[];
  clipIds: string[];
  /** 闭区间 [startFrame, endFrame]，按「场边界 = 下一场首帧」分区。 */
  startFrame: number;
  endFrame: number;
}

export type PlanSceneSegmentFrameRangesResult =
  | { success: true; segments: SceneSegmentFramePlan[] }
  | { success: false; issues: string[] };

/**
 * 帧分区：场 i 覆盖 `[场i首clip.from, 场i+1首clip.from - 1]`，末场收在
 * `durationInFrames - 1`。分区天然含场尾转场重叠帧——**全部场段按序拼接
 * 等于整章逐帧**（无损拼回性质）。
 */
export function planSceneSegmentFrameRanges(input: {
  clips: readonly SceneSegmentClipTiming[];
  durationInFrames: number;
  scenes: readonly SceneSegmentSceneInput[];
}): PlanSceneSegmentFrameRangesResult {
  const issues: string[] = [];
  const { clips, durationInFrames, scenes } = input;
  if (clips.length === 0) return { success: false, issues: ["章节没有任何视觉片段"] };
  if (scenes.length === 0) return { success: false, issues: ["场分组为空"] };
  if (
    !Number.isInteger(durationInFrames)
    || durationInFrames < 1
    || durationInFrames > clips.reduce((end, clip) => Math.max(end, clip.from + clip.durationInFrames), 0)
  ) {
    return { success: false, issues: [`章节总帧数非法：${durationInFrames}`] };
  }

  const clipIndexByStoryboardId = new Map<string, number>();
  clips.forEach((clip, index) => {
    if (clipIndexByStoryboardId.has(clip.storyboardId)) {
      issues.push(`分镜 ${clip.storyboardId} 对应多个视觉片段`);
    }
    clipIndexByStoryboardId.set(clip.storyboardId, index);
  });

  const seenStoryboardIds = new Set<string>();
  const seenSceneNos = new Set<number>();
  const firstClipIndexPerScene: number[] = [];
  for (const scene of scenes) {
    if (!Number.isInteger(scene.sceneNo) || scene.sceneNo < 1 || seenSceneNos.has(scene.sceneNo)) {
      issues.push(`场号非法或重复：${scene.sceneNo}`);
    }
    seenSceneNos.add(scene.sceneNo);
    if (scene.storyboardIds.length === 0) {
      issues.push(`场 ${scene.sceneNo} 没有任何分镜`);
      continue;
    }
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const storyboardId of scene.storyboardIds) {
      if (seenStoryboardIds.has(storyboardId)) {
        issues.push(`分镜 ${storyboardId} 被多个场引用`);
        continue;
      }
      seenStoryboardIds.add(storyboardId);
      const clipIndex = clipIndexByStoryboardId.get(storyboardId);
      if (clipIndex === undefined) {
        issues.push(`分镜 ${storyboardId} 在章节渲染计划中没有视觉片段`);
        continue;
      }
      firstIndex = Math.min(firstIndex, clipIndex);
    }
    firstClipIndexPerScene.push(firstIndex);
  }
  const clipStoryboardIds = new Set(clips.map((clip) => clip.storyboardId));
  for (const storyboardId of clipStoryboardIds) {
    if (!seenStoryboardIds.has(storyboardId)) {
      issues.push(`分镜 ${storyboardId} 不属于任何场`);
    }
  }
  for (let index = 1; index < firstClipIndexPerScene.length; index += 1) {
    if (firstClipIndexPerScene[index]! <= firstClipIndexPerScene[index - 1]!) {
      issues.push("场顺序与渲染计划片段顺序不一致");
    }
  }
  if (issues.length > 0) return { success: false, issues };

  const segments: SceneSegmentFramePlan[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]!;
    const firstClipIndex = firstClipIndexPerScene[index]!;
    const startFrame = clips[firstClipIndex]!.from;
    const endFrameExclusive = index + 1 < scenes.length
      ? clips[firstClipIndexPerScene[index + 1]!]!.from
      : durationInFrames;
    const endFrame = endFrameExclusive - 1;
    if (
      !Number.isInteger(startFrame)
      || !Number.isInteger(endFrame)
      || startFrame < 0
      || startFrame > endFrame
      || endFrame >= durationInFrames
    ) {
      issues.push(`场 ${scene.sceneNo} 帧区间非法：[${startFrame}, ${endFrame}] / ${durationInFrames}`);
      continue;
    }
    segments.push({
      sceneNo: scene.sceneNo,
      sceneName: scene.sceneName,
      storyboardIds: [...scene.storyboardIds],
      clipIds: clips
        .slice(firstClipIndex, index + 1 < scenes.length ? firstClipIndexPerScene[index + 1]! : clips.length)
        .map((clip) => clip.clipId),
      startFrame,
      endFrame,
    });
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, segments };
}

/** 场名 → 文件名安全片段（去路径分隔/控制字符，限长）。 */
export function sanitizeSceneSegmentName(sceneName: string): string {
  const sanitized = sceneName
    // eslint-disable-next-line no-control-regex -- 文件名安全化必须剔除控制字符
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 24)
    .replace(/^-+|-+$/g, "");
  return sanitized || "scene";
}
