// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 分镜图人审硬门·引擎侧队列兜底(1125 用户令「所有出视频的入口都拦」):
 * 宿主每 5s 推分镜快照(每镜带 humanApproved=宿主门禁函数现算的图片人审结论),
 * 发车前按节点类分两腿对账——
 *  - MyShot/ManyingShot 带 video:按 shot_id 逐镜对账;
 *  - MyDirectorConsole:当章(currentEpisodeId)全镜对账;
 * 任一未审/快照过期或缺项目=抛错拦队列(GPU 零花费)。任意手搓图(无分镜绑定)
 * 无 shot_id 可对账,如实不覆盖(PRD Non-Goals)。纯函数无 DOM 依赖,pytest 经
 * node 直跑断言(test_human_review_gate_queue.js)。
 */

export const VIDEO_SHOT_CLASSES = ["MyShot", "ManyingShot"];
export const DIRECTOR_CONSOLE_CLASSES = ["MyDirectorConsole"];

/** 队列提交里「在本轮执行范围内」的输出节点表(partialExecutionTargets 过滤)。 */
export function outputNodesInScope(data) {
  const targets = data?.partialExecutionTargets;
  const entries = Object.entries(data?.output ?? {});
  if (!Array.isArray(targets) || targets.length === 0) return entries;
  return entries.filter(([id]) => targets.some((target) => String(target) === id));
}

/** 范围内是否存在视频产出节点(MyShot 带 video/导演台)——宿主据此决定是否
 *  拉快照对账(非视频提交零快照往返)。 */
export function hasVideoOutputInScope(data) {
  return outputNodesInScope(data).some(([, node]) => (
    (VIDEO_SHOT_CLASSES.includes(node.class_type) && node.inputs?.video)
    || DIRECTOR_CONSOLE_CLASSES.includes(node.class_type)
  ));
}

/** 快照新鲜度(与 theme.js snapshotOrigin 同窗 15s):过期/缺项目=抛错。 */
export function requireFreshSnapshot(snapshot) {
  const origin = snapshot?.originProjectId;
  if (typeof origin !== "string" || !origin.trim() || !Number.isFinite(snapshot.updatedAt)
      || Date.now() - snapshot.updatedAt > Math.min(snapshot.staleAfterMs || 15000, 15000)) {
    throw new Error("分镜人审快照已过期或未绑定项目——请打开漫影画布后再出视频(全章节人审硬门)");
  }
  return origin;
}

function shotLabel(snapshot, shotId) {
  const shot = (snapshot?.shots ?? []).find((item) => item.id === shotId);
  return shot?.label || shotId;
}

/**
 * 队列级人审对账:通过=静默;不通过=抛大白话(入口=引擎队列,GPU 未启动)。
 * 仅对本轮执行范围内的视频产出节点(MyShot 带 video / MyDirectorConsole)生效。
 */
export function assertHumanReviewForQueue(data, snapshot) {
  const nodesInScope = outputNodesInScope(data);
  const shotTargets = [];
  let directorConsole = false;
  for (const [id, node] of nodesInScope) {
    if (VIDEO_SHOT_CLASSES.includes(node.class_type) && node.inputs?.video) {
      shotTargets.push({ id, shotId: String(node.inputs.shot_id ?? "") });
    } else if (DIRECTOR_CONSOLE_CLASSES.includes(node.class_type)) {
      directorConsole = true;
    }
  }
  if (shotTargets.length === 0 && !directorConsole) return; // 非视频产出提交不属本门

  requireFreshSnapshot(snapshot); // 无快照/过期/缺项目=无法对账,拦下(宿主须在场)
  const shots = Array.isArray(snapshot.shots) ? snapshot.shots : [];

  const blockedShots = shotTargets
    .filter((target) => {
      if (!target.shotId) return true; // 无 shot_id=无法对账,拦下要求重开
      const shot = shots.find((item) => item.id === target.shotId);
      return !shot || shot.humanApproved !== true;
    })
    .map((target) => shotLabel(snapshot, target.shotId) || target.id);
  if (blockedShots.length > 0) {
    throw new Error(`分镜未通过图片人审,禁止出视频(全章节硬门):${blockedShots.join("、")}——请在漫影工作台「图片人审」区逐镜看图通过后重试`);
  }

  if (directorConsole) {
    const episodeShots = snapshot.currentEpisodeId
      ? shots.filter((item) => !item.episodeId || item.episodeId === snapshot.currentEpisodeId)
      : shots;
    const unreviewed = episodeShots
      .filter((item) => item.humanApproved !== true)
      .map((item) => item.label || item.id);
    if (unreviewed.length > 0) {
      throw new Error(`导演台当章有 ${unreviewed.length} 镜未通过图片人审,禁止出视频(全章节硬门):${unreviewed.join("、")}——请在漫影工作台「图片人审」区逐镜看图通过后重试`);
    }
  }
}
