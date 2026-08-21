import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import { readRemotionCurrentShotSlotsFromWorkspace } from "@/lib/studio/remotion/remotion-current-slot";
import { projectVideoUseArtifactToEditingProject } from "@/lib/studio/video-workflow/editing-project-projection";
import { validateVideoUseChapterArtifact } from "@rendering/contracts/video-workflow";
import type { EditingProjectV1 } from "@/types/editing";

const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";

interface PersistedEditingState {
  state?: {
    activeProjectId?: string;
    editingProjects?: Record<string, EditingProjectV1>;
    currentEditingProjectIdByEpisode?: Record<string, string>;
  };
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main(): Promise<void> {
  const projectRoot = process.env.MYSTUDIO_FORMAL_PROJECT_ROOT?.trim()
    || "/Users/zhengbingjin/Project/IP/MA";
  const revision = Number(process.env.MYSTUDIO_FORMAL_REVISION);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("MYSTUDIO_FORMAL_REVISION 必须是正整数");
  }
  const sourceRunDir = process.env.MYSTUDIO_FORMAL_SOURCE_MATERIALIZE_DIR?.trim()
    || path.join(
      "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation",
      `formal-source-r${revision}-${Date.now()}`,
    );
  const editingStatePath = path.join(projectRoot, "store", "editing.json");
  const videoUseArtifactPath = path.join(
    projectRoot,
    "video-use",
    CHAPTER_ID,
    `r${revision}`,
    "video-use-artifact.json",
  );
  const remotionRoot = path.join(projectRoot, "remotion");
  const targetArtifactResult = validateVideoUseChapterArtifact(readJson(videoUseArtifactPath));
  if (!targetArtifactResult.success) {
    throw new Error(`r${revision} video-use artifact 无效: ${targetArtifactResult.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }

  const editingState = readJson(editingStatePath) as PersistedEditingState;
  const projects = editingState.state?.editingProjects ?? {};
  const currentProjectId = editingState.state?.currentEditingProjectIdByEpisode?.[CHAPTER_ID];
  const baseProject = (currentProjectId ? projects[currentProjectId] : undefined)
    ?? Object.values(projects).find((project) => project.projectId === PROJECT_ID && project.episodeId === CHAPTER_ID);
  if (!baseProject) throw new Error("当前章节 EditingProject 不存在");

  const slots = await readRemotionCurrentShotSlotsFromWorkspace(remotionRoot, PROJECT_ID, CHAPTER_ID);
  let projectedProject = baseProject;
  const appliedRevisions: number[] = [];
  let authorityProjection: { revision: number; inheritedFromRevision: number } | undefined;
  for (let appliedRevision = baseProject.revision + 1; appliedRevision <= revision; appliedRevision += 1) {
    const currentArtifactPath = path.join(
      projectRoot,
      "video-use",
      CHAPTER_ID,
      `r${appliedRevision}`,
      "video-use-artifact.json",
    );
    const artifactResult = validateVideoUseChapterArtifact(readJson(currentArtifactPath));
    if (!artifactResult.success) {
      throw new Error(`r${appliedRevision} video-use artifact 无效: ${artifactResult.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    }
    if (slots.length !== artifactResult.value.edl.length) {
      throw new Error(`r${appliedRevision} accepted EDL 与 current shot slots 数量不一致: slots=${slots.length}, edl=${artifactResult.value.edl.length}`);
    }
    let artifactForProjection = artifactResult.value;
    if (!artifactForProjection.subtitleAuthority && appliedRevision === revision) {
      const priorArtifactPath = path.join(
        projectRoot,
        "video-use",
        CHAPTER_ID,
        `r${appliedRevision - 1}`,
        "video-use-artifact.json",
      );
      const priorResult = validateVideoUseChapterArtifact(readJson(priorArtifactPath));
      const priorAuthority = priorResult.success ? priorResult.value.subtitleAuthority : undefined;
      if (!priorAuthority
        || priorAuthority.mode !== "source-embedded"
        || priorAuthority.evidence?.sourceFingerprint !== artifactForProjection.evidence.inputSha256) {
        throw new Error(`r${appliedRevision} 缺少可继承的同源 source-embedded authority`);
      }
      artifactForProjection = { ...artifactForProjection, subtitleAuthority: priorAuthority };
      authorityProjection = { revision: appliedRevision, inheritedFromRevision: appliedRevision - 1 };
    }
    const projected = projectVideoUseArtifactToEditingProject({
      project: projectedProject,
      artifact: artifactForProjection,
      now: Date.now(),
      shotSlots: slots,
    });
    if (!projected.success) {
      throw new Error(`r${appliedRevision} accepted artifact 投影失败: ${projected.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    }
    projectedProject = projected.project;
    appliedRevisions.push(appliedRevision);
  }
  const compiled = compileTimelineRenderPlan(projectedProject, {
    jobId: `formal-source-r${revision}-${Date.now()}`,
    createdAt: Date.now(),
  });
  if (!compiled.success) {
    throw new Error(`当前源码编译 TimelineRenderPlan 失败: ${compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  const plan = compiled.value;
  const visualClips = plan.clips.filter((clip) => clip.trackKind === "video" || clip.trackKind === "image");
  const textClips = plan.clips.filter((clip) => clip.trackKind === "text");
  const subtitleAuthority = targetArtifactResult.value.subtitleAuthority?.mode
    ?? (authorityProjection?.revision === revision ? "source-embedded" : undefined);
  if (subtitleAuthority !== "source-embedded" && subtitleAuthority !== "clean-remotion") {
    throw new Error(`r${revision} 缺少可验证的正式字幕归属`);
  }
  const expectedSubtitleMode = subtitleAuthority === "clean-remotion" ? "burn-in" : "none";
  const expectedTextClipCount = subtitleAuthority === "clean-remotion"
    ? targetArtifactResult.value.subtitles.length
    : 0;
  if (plan.editingRevision !== revision
    || visualClips.length !== 43
    || textClips.length !== expectedTextClipCount
    || plan.renderSettings.subtitleMode !== expectedSubtitleMode) {
    throw new Error(`当前源码投影不满足正式输入: revision=${plan.editingRevision}, visual=${visualClips.length}, text=${textClips.length}`);
  }
  fs.mkdirSync(sourceRunDir, { recursive: true });
  const planPath = path.join(sourceRunDir, "timeline-render-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  const provenance = {
    schemaVersion: 1,
    source: "current-disk-accepted-video-use-plus-current-editing-project",
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    revision,
    baseEditingProjectRevision: baseProject.revision,
    appliedRevisions,
    ...(authorityProjection ? { authorityProjection } : {}),
    videoUseArtifactPath,
    videoUseArtifactSha256: sha256File(videoUseArtifactPath),
    shotSlotCount: slots.length,
    timelinePlanPath: planPath,
    timelinePlanSha256: sha256File(planPath),
    visualClipCount: visualClips.length,
    textClipCount: textClips.length,
    subtitleAuthority,
    subtitleMode: plan.renderSettings.subtitleMode,
  };
  fs.writeFileSync(path.join(sourceRunDir, "source-materialization.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(provenance, null, 2)}\n`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
