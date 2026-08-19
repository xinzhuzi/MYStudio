import {
  REMOTION_MEDIA_ROLES,
  type ProjectMediaReference,
  type RemotionRenderJobTarget,
} from "@/types/remotion-workspace";
import { isKnownSubtitleFontId } from "./subtitle-fonts";
import { isCinematicLutId } from "./cinematic-luts";
import { RemotionValidator } from "./remotion-validation-utils";

export function validateEditingRenderSettings(
  value: unknown,
  path: string,
  validator: RemotionValidator,
): void {
  const record = validator.record(value, path, [
    "width",
    "height",
    "fps",
    "codec",
    "subtitleMode",
    // 08-20 补齐：subtitleFont 注入(08-19 字体链)与 chapterGrade/subtitleSfxEnabled
    // (08-19 导演定调/字幕音效)此前缺白名单——App 一键成片经 shotValidationManifest
    // 校验时被"字段不属于当前 schema"全镜阻断(CLI 硬编码窄形状不触发，故潜伏)。
    "subtitleFont",
    "chapterGrade",
    "subtitleSfxEnabled",
    "loudnessLufs",
    "truePeakDbtp",
    "audioDucking",
  ]);
  if (!record) return;
  validator.integer(record.width, `${path}.width`, 1);
  validator.integer(record.height, `${path}.height`, 1);
  validator.integer(record.fps, `${path}.fps`, 1);
  validator.exact(record.codec, "h264", `${path}.codec`);
  validator.enum(record.subtitleMode, ["burn-in", "none"], `${path}.subtitleMode`);
  if (record.subtitleFont !== undefined && !isKnownSubtitleFontId(record.subtitleFont)) {
    validator.issue(`${path}.subtitleFont`, "字幕字体必须是注册表内的字体 id");
  }
  if (record.chapterGrade !== undefined) {
    const grade = record.chapterGrade as { lutId?: unknown; blend?: unknown } | null;
    if (typeof grade !== "object" || grade === null || typeof grade.lutId !== "string" || !isCinematicLutId(grade.lutId)) {
      validator.issue(`${path}.chapterGrade.lutId`, "章节色调必须在 LUT 闭集内");
    } else if (
      grade.blend !== undefined
      && (typeof grade.blend !== "number" || !Number.isFinite(grade.blend) || grade.blend < 0 || grade.blend > 1)
    ) {
      validator.issue(`${path}.chapterGrade.blend`, "章节色调混合强度必须是 0..1 有限数");
    }
  }
  if (record.subtitleSfxEnabled !== undefined && typeof record.subtitleSfxEnabled !== "boolean") {
    validator.issue(`${path}.subtitleSfxEnabled`, "字幕音效开关必须是布尔值");
  }
  validator.finite(record.loudnessLufs, `${path}.loudnessLufs`);
  validator.finite(record.truePeakDbtp, `${path}.truePeakDbtp`);
  if (record.audioDucking === undefined) return;
  const ducking = validator.record(record.audioDucking, `${path}.audioDucking`, [
    "reductionDb",
    "attackUs",
    "releaseUs",
  ]);
  if (!ducking) return;
  validator.range(ducking.reductionDb, -60, 0, `${path}.audioDucking.reductionDb`);
  validator.integer(ducking.attackUs, `${path}.audioDucking.attackUs`, 0);
  validator.integer(ducking.releaseUs, `${path}.audioDucking.releaseUs`, 0);
}

export function validateProjectMediaReference(
  value: unknown,
  expectedProjectId: string,
  path: string,
  validator: RemotionValidator,
): ProjectMediaReference | undefined {
  const record = validator.record(value, path, [
    "kind",
    "projectId",
    "relativePath",
    "contentSha256",
    "provenance",
  ]);
  if (!record) return undefined;
  validator.enum(record.kind, ["project-file", "local-import"], `${path}.kind`);
  const projectId = validator.id(record.projectId, `${path}.projectId`);
  if (projectId && projectId !== expectedProjectId) {
    validator.issue(`${path}.projectId`, "媒体引用必须属于当前项目", "remotion.media.project_mismatch");
  }
  validator.relativePath(record.relativePath, `${path}.relativePath`);
  validator.sha256(record.contentSha256, `${path}.contentSha256`);
  const provenance = validator.record(record.provenance, `${path}.provenance`, [
    "sourceKind",
    "sourceId",
    "sourceVersion",
  ]);
  if (provenance) {
    validator.enum(
      provenance.sourceKind,
      ["storyboard", "generated", "imported", "remotion-output"],
      `${path}.provenance.sourceKind`,
    );
    validator.nonEmptyString(provenance.sourceId, `${path}.provenance.sourceId`);
    validator.nonEmptyString(provenance.sourceVersion, `${path}.provenance.sourceVersion`);
  }
  return record as unknown as ProjectMediaReference;
}

export function validateShotMotion(value: unknown, path: string, validator: RemotionValidator): void {
  const record = validator.record(value, path, ["kind", "fromScale", "toScale", "originX", "originY"]);
  if (!record) return;
  const kind = validator.enum(record.kind, ["static", "pan-zoom"], `${path}.kind`);
  for (const key of ["fromScale", "toScale"] as const) {
    if (record[key] !== undefined) {
      const scale = validator.finite(record[key], `${path}.${key}`);
      if (scale !== undefined && scale <= 0) validator.issue(`${path}.${key}`, "缩放必须大于 0");
    }
  }
  for (const key of ["originX", "originY"] as const) {
    if (record[key] !== undefined) validator.range(record[key], 0, 1, `${path}.${key}`);
  }
  if (kind === "pan-zoom" && record.fromScale === undefined && record.toScale === undefined) {
    validator.issue(path, "pan-zoom 至少需要一个缩放端点");
  }
}

export function validateEditingTransform(value: unknown, path: string, validator: RemotionValidator): void {
  const record = validator.record(value, path, ["x", "y", "scaleX", "scaleY", "rotation", "opacity"]);
  if (!record) return;
  validator.finite(record.x, `${path}.x`);
  validator.finite(record.y, `${path}.y`);
  for (const key of ["scaleX", "scaleY"] as const) {
    const scale = validator.finite(record[key], `${path}.${key}`);
    if (scale !== undefined && scale <= 0) validator.issue(`${path}.${key}`, "缩放必须大于 0");
  }
  validator.finite(record.rotation, `${path}.rotation`);
  validator.range(record.opacity, 0, 1, `${path}.opacity`);
}

export function validateRemotionJobTarget(
  value: unknown,
  path: string,
  validator: RemotionValidator,
): RemotionRenderJobTarget | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    validator.issue(path, "target 必须是对象");
    return undefined;
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "shot") {
    const record = validator.record(value, path, ["kind", "chapterId", "shotId", "shotRevision"]);
    if (!record) return undefined;
    const chapterId = validator.id(record.chapterId, `${path}.chapterId`);
    const shotId = validator.id(record.shotId, `${path}.shotId`);
    const shotRevision = validator.integer(record.shotRevision, `${path}.shotRevision`, 1);
    return chapterId && shotId && shotRevision !== undefined
      ? { kind, chapterId, shotId, shotRevision }
      : undefined;
  }
  if (kind === "chapter") {
    const record = validator.record(value, path, ["kind", "chapterId", "editingProjectId", "editingRevision"]);
    if (!record) return undefined;
    const chapterId = validator.id(record.chapterId, `${path}.chapterId`);
    const editingProjectId = validator.id(record.editingProjectId, `${path}.editingProjectId`);
    const editingRevision = validator.integer(record.editingRevision, `${path}.editingRevision`, 1);
    return chapterId && editingProjectId && editingRevision !== undefined
      ? { kind, chapterId, editingProjectId, editingRevision }
      : undefined;
  }
  validator.issue(`${path}.kind`, "target.kind 必须是 shot 或 chapter");
  return undefined;
}

export function validateMediaRole(value: unknown, path: string, validator: RemotionValidator): string | undefined {
  return validator.enum(value, REMOTION_MEDIA_ROLES, path);
}
