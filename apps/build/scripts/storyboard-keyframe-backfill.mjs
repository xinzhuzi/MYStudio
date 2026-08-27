#!/usr/bin/env node
/**
 * 分镜关键帧回接规划器(Trellis 08-27-storyboard-keyframe-sequence M1c / design §2)
 *
 * 只读旧 82 镜快照与新 38 镜现势,按确定性算法产出 keyframes mapping JSON + 人读报告。
 * **不写 store**——写入走应用内 setStoryboardKeyframes(id, frames, "backfill"),须人工确认本报告后执行。
 *
 * 算法:时间轴对位(旧镜中心点落入新镜区间)→语义加分(出镜角色名∩旧镜资产名 ×2
 *       + 画面描述关键词重合 ×1)→每新镜取前 2 帧(≤4)→一图一用→置信度分级。
 *
 * 用法: node storyboard-keyframe-backfill.mjs --project <IP/MA> [--backup <bak目录>] [--max-per-shot 2] [--out <dir>]
 * 默认 backup = 项目内最新的 store/studio-workflow.bak-*（含 storyboards 快照者）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { statSync } from "node:fs";

function findStoryboardShards(rootDir) {
  const shards = [];
  // 覆盖三种目录形态:项目根(store/studio-workflow/...)、备份根(chapters/...)、域目录本身
  const chapterDir = join(rootDir, "store/studio-workflow/chapters/chapter-001");
  const fallbackDir = join(rootDir, "store/studio-workflow");
  const backupChapter = join(rootDir, "chapters/chapter-001");
  for (const dir of [chapterDir, fallbackDir, backupChapter, rootDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (/^storyboards-.*\.json$/.test(name)) shards.push(join(dir, name));
    }
  }
  return shards;
}

function aggregateStoryboards(rootDir) {
  const byId = new Map();
  // 分片增量轮换:哈希文件名序≠写入序,按 mtime 排序让最新写入胜出
  const files = findStoryboardShards(rootDir).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    const state = parsed.state ?? parsed;
    const list = Array.isArray(state.storyboards) ? state.storyboards : [];
    for (const item of list) {
      if (!item?.id) continue;
      // 图片优先合并:同 id 后写的无图记录(轮换分片旧态)不得覆盖已有图记录
      const existing = byId.get(item.id);
      if (existing && withImage(existing) && !withImage(item)) continue;
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function withImage(item) {
  return item?.mediaRef?.kind === "image" && item.mediaRef.path ? item : null;
}

function normalizeAxis(items) {
  const durations = items.map((item) => (item.durationTarget ?? item.duration ?? 0) * 1_000_000);
  const total = durations.reduce((sum, value) => sum + value, 0) || 1;
  const points = [];
  let cursor = 0;
  items.forEach((item, index) => {
    points.push({ item, start: cursor / total, end: (cursor + durations[index]) / total, durationUs: durations[index] });
    cursor += durations[index];
  });
  return { points, total };
}

function roleNames(item) {
  const fromAssets = (item.associateAssetsNames ?? []);
  const fromSemantics = ((item.shotSemantics ?? {}).visibleCharacters ?? []).map((c) => c.name);
  return new Set([...fromAssets, ...fromSemantics].filter(Boolean));
}

function keywords(text) {
  return new Set(
    String(text ?? "")
      .replace(/[\s，。？！、：；—…""''「」（）]/g, "")
      .split(/(.{2})/)
      .filter((token) => token.length >= 2),
  );
}

function scoreCandidate(newShot, legacyShot) {
  const newRoles = roleNames(newShot);
  const legacyRoles = [...roleNames(legacyShot)];
  const roleOverlap = legacyRoles.filter((name) => newRoles.has(name)).length;
  const newKeys = keywords(newShot.videoDesc ?? newShot.prompt);
  const legacyKeys = keywords(legacyShot.videoDesc ?? legacyShot.prompt);
  let keyOverlap = 0;
  for (const token of legacyKeys) if (newKeys.has(token)) keyOverlap += 1;
  return { roleOverlap, keyOverlap, score: roleOverlap * 2 + Math.min(keyOverlap, 6) };
}

/** 口径(2026-08-27 校准):时间轴包含已是强前置约束;
 * high=角色重合≥1(出镜角色在新镜语义/资产里真实出现);
 * medium=仅画面关键词重合;low=仅时间对位(人审重点看)。 */
function confidenceOf(roleOverlap, keyOverlap) {
  if (roleOverlap >= 1) return "high";
  if (keyOverlap >= 2) return "medium";
  return "low";
}

function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const project = readArg("project");
  if (!project || !existsSync(project)) {
    console.error("用法: storyboard-keyframe-backfill.mjs --project <IP/MA> [--backup <bak目录>] [--max-per-shot 2] [--out <dir>]");
    process.exit(1);
  }
  const maxPerShot = Number(readArg("max-per-shot") ?? 2);
  const outDir = readArg("out") ?? "/tmp/storyboard-keyframe-backfill";

  let backup = readArg("backup");
  if (!backup) {
    // 自动挑备份:有图镜数最多者优先(字母序会选到早期备份——bak-soften 坑,2026-08-27 实证)
    const storeRoot = join(project, "store");
    const candidates = readdirSync(storeRoot)
      .filter((name) => name.startsWith("studio-workflow.bak-"))
      .map((name) => join(storeRoot, name))
      .map((dir) => ({ dir, imaged: aggregateStoryboards(dir).filter(withImage).length }))
      .filter((entry) => entry.imaged > 0)
      .sort((a, b) => b.imaged - a.imaged || a.dir.localeCompare(b.dir));
    backup = candidates[0]?.dir;
  }
  if (!backup || !existsSync(backup)) {
    console.error("找不到含 storyboards 快照的备份目录(store/studio-workflow.bak-*)");
    process.exit(1);
  }

  const legacyAll = aggregateStoryboards(backup).filter(withImage);
  const currentAll = aggregateStoryboards(project).filter((item) => item.episodeId === "chapter-001");
  if (!legacyAll.length || !currentAll.length) {
    console.error(`快照异常: 旧镜(有图)=${legacyAll.length}, 新镜=${currentAll.length}`);
    process.exit(1);
  }

  const legacyAxis = normalizeAxis(legacyAll);
  const newAxis = normalizeAxis(currentAll);
  const usedLegacy = new Set();
  const mapping = [];
  const missing = [];
  let highCount = 0;

  for (const newPoint of newAxis.points) {
    const candidates = [];
    legacyAxis.points.forEach((legacyPoint, legacyIndex) => {
      const center = (legacyPoint.start + legacyPoint.end) / 2;
      if (center < newPoint.start || center >= newPoint.end) return;
      const { score, roleOverlap, keyOverlap } = scoreCandidate(newPoint.item, legacyPoint.item);
      candidates.push({ legacyIndex, legacyPoint, score, roleOverlap, keyOverlap, center });
    });
    candidates.sort((a, b) => b.score - a.score || a.legacyIndex - b.legacyIndex);
    const picked = candidates.filter((c) => !usedLegacy.has(c.legacyIndex)).slice(0, maxPerShot);
    picked.forEach((c) => usedLegacy.add(c.legacyIndex));

    const frames = picked.map((c, frameIndex) => {
      const confidence = confidenceOf(c.roleOverlap, c.keyOverlap);
      if (confidence === "high") highCount += 1;
      const ratio = (c.center - newPoint.start) / (newPoint.end - newPoint.start || 1);
      const inUs = frameIndex === 0
        ? 0
        : Math.max(500_000, Math.round((ratio * newPoint.durationUs) / 500_000) * 500_000);
      return {
        frameId: `${newPoint.item.id}-kf-${frameIndex + 1}`,
        legacyIndex: c.legacyIndex + 1,
        path: c.legacyPoint.item.mediaRef.path,
        inUs,
        confidence,
        score: c.score,
        roleOverlap: c.roleOverlap,
      };
    });
    if (frames.length === 0) missing.push({ shotId: newPoint.item.id, index: newPoint.item.index });
    mapping.push({
      shotId: newPoint.item.id,
      index: newPoint.item.index,
      durationUs: newPoint.durationUs,
      frames,
      candidateCount: candidates.length,
    });
  }

  const reused = mapping.reduce((sum, row) => sum + row.frames.length, 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    backup,
    legacyShotsWithImage: legacyAll.length,
    newShots: currentAll.length,
    framesReused: reused,
    legacyUnused: legacyAll.length - usedLegacy.size,
    shotsMissingFrames: missing.length,
    highConfidenceFrames: highCount,
    highConfidenceRatio: reused ? Number((highCount / reused).toFixed(3)) : 0,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "mapping.json"), JSON.stringify({ summary, mapping, missing }, null, 2));

  const lines = [
    "# 分镜关键帧回接报告(人审后经应用内确认写入)",
    "",
    `- 旧镜(有图): ${summary.legacyShotsWithImage} · 新镜: ${summary.newShots}`,
    `- 回接帧: ${summary.framesReused} · 未用旧图: ${summary.legacyUnused} · 缺帧镜: ${summary.shotsMissingFrames}`,
    `- 高置信帧占比: ${(summary.highConfidenceRatio * 100).toFixed(1)}% (验收线 ≥90%)`,
    "",
    "| 镜 | 时长s | 帧 | 旧镜 | inUs | 置信 | 角色∩ | 候选 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const row of mapping) {
    const frameText = row.frames.length
      ? row.frames.map((f) => `KF${f.frameId.slice(-1)}←旧${f.legacyIndex}(${f.confidence},${Math.round(f.inUs / 1000)}ms)`).join(" ")
      : "⚠缺帧";
    lines.push(`| ${row.index} | ${Math.round(row.durationUs / 1_000_000)} | ${row.frames.length} | ${frameText} | ${row.candidateCount} |`);
  }
  writeFileSync(join(outDir, "report.md"), lines.join("\n"));
  console.log(`回接完成: ${reused} 帧 / ${summary.highConfidenceRatio * 100 >= 90 ? "✅" : "⚠️"} 高置信 ${(summary.highConfidenceRatio * 100).toFixed(1)}%`);
  console.log(`报告: ${join(outDir, "report.md")}`);
  console.log(`映射: ${join(outDir, "mapping.json")}`);
}

main();
