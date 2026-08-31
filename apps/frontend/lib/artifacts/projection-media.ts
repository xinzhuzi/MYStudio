import type { ArtifactRecord, RemotionJob, RemotionManifest } from "@/types/artifacts";
import { ContinuityAssetVersionWithOwnership, EditingProject, EditingRenderRecord, EditingRun, ProjectableMediaFile, buildArtifactId } from "./projection-shared";

/**
 * 剪辑与资产域投影——剪辑工程/运行/渲染、Remotion 产物、连续性圣经/基础资产/媒体文件。file-size-reduction P1 拆出,体逐字保留。
 */
export function projectEditingProjects(
  projects: EditingProject[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return projects
    .filter((p) => p.projectId === projectId && (!chapterId || p.episodeId === chapterId))
    .map((project) => {
      const artId = buildArtifactId("editing", "editing-project", project.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "editing",
        kind: "editing-project",
        state: "active",
        name: `Editing Project ${project.id.slice(-6)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/editing/project/${project.id}` };
    });
}

/**
 * Map editing runs to editing-run artifacts
 */
export function projectEditingRuns(
  runs: EditingRun[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return runs
    .filter((r) => r.projectId === projectId && (!chapterId || r.episodeId === chapterId))
    .map((run) => {
      const artId = buildArtifactId("editing", "editing-run", run.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "editing",
        kind: "editing-run",
        state: "active",
        name: `Editing Run ${run.id.slice(-6)}`,
        createdAt: run.startedAt,
        updatedAt: run.completedAt ?? run.startedAt,
        physicalRefs: [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/editing/run/${run.id}` };
    });
}

/**
 * Map editing render records to editing-render artifacts
 */
export function projectEditingRenders(
  renders: EditingRenderRecord[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return renders
    .filter((r) => r.projectId === projectId && (!chapterId || r.episodeId === chapterId))
    .map((render) => {
      const artId = buildArtifactId("editing", "editing-render", render.id);
      return {
        id: artId,
        projectId,
        chapterId,
        stage: "editing",
        kind: "editing-render",
        state: "active",
        name: `Editing Render ${render.id.slice(-6)}`,
        createdAt: render.startedAt,
        updatedAt: render.completedAt ?? render.startedAt,
        physicalRefs: render.outputPath
          ? [
              {
                type: "exports",
                path: render.outputPath,
                bytes: undefined,
                hash256: undefined },
            ]
          : [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
        editRoute: `/editing/render/${render.id}` };
    });
}

/**
 * Map Remotion manifests/jobs to remotion artifacts
 *
 * All Remotion records are chapter-scoped, never episode-scoped.
 */
export function projectRemotionArtifacts(
  projectId: string,
  manifest?: RemotionManifest,
  jobs?: RemotionJob[],
  chapterId?: string
): ArtifactRecord[] {
  const records: ArtifactRecord[] = [];

  if (
    manifest
    && (!manifest.projectId || manifest.projectId === projectId)
    && (!chapterId || manifest.chapterId === chapterId)
  ) {
    const manifestChapterId = manifest.chapterId;
    const artId = buildArtifactId("remotion", "remotion-manifest", manifestChapterId ?? "manifest");
    records.push({
      id: artId,
      projectId,
      chapterId: manifestChapterId,
      stage: "remotion",
      kind: "remotion-manifest",
      state: "active",
      name: "Remotion Manifest",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: jobs?.map((j) => buildArtifactId("remotion", "remotion-job", j.id)) ?? [],
      deletePolicy: "delete-exclusive-downstream",
      editRoute: `/remotion/manifest` });
  }

  if (jobs) {
    // All Remotion records use chapterId, NEVER episodeId
    jobs
      .filter((j) => (!j.projectId || j.projectId === projectId) && (!chapterId || j.chapterId === chapterId))
      .forEach((job) => {
        const artId = buildArtifactId("remotion", "remotion-job", job.id);
        records.push({
          id: artId,
          projectId,
          chapterId: job.chapterId,
          stage: "remotion",
          kind: "remotion-job",
          state: "active",
          name: `Remotion Job ${job.id.slice(-6)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          physicalRefs: [],
          upstreamIds: [buildArtifactId("remotion", "remotion-manifest", job.chapterId ?? "manifest")],
          downstreamIds: [],
          deletePolicy: "delete-exclusive-downstream",
          editRoute: `/remotion/job/${job.id}` });
      });
  }

  return records;
}

/**
 * Map continuity bible versions to continuity-bible artifacts
 */
export function projectContinuityBibles(
  versions: ContinuityAssetVersionWithOwnership[],
  projectId: string,
  chapterId?: string
): ArtifactRecord[] {
  return versions
    .filter((v) => v.assetKind === "character" || v.assetKind === "scene" || v.assetKind === "prop")
    .map((version) => {
      const explicitOwnerIds = Array.from(new Set(
        [version.chapterId, version.episodeId]
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ));
      const ownedChapterId = explicitOwnerIds.length === 1 ? explicitOwnerIds[0] : undefined;
      return { version, ownedChapterId };
    })
    .filter(({ ownedChapterId }) => !chapterId || !ownedChapterId || ownedChapterId === chapterId)
    .map(({ version, ownedChapterId }) => {
      const artId = buildArtifactId("assets", "continuity-bible", `${version.assetId}-${version.versionId}`);
      const ownershipResolved = Boolean(ownedChapterId);
      return {
        id: artId,
        projectId,
        chapterId: ownedChapterId,
        stage: "assets",
        kind: "continuity-bible",
        state: version.structurallyComplete ? "active" : "blocked",
        name: `${version.assetKind} Version: ${version.label}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        physicalRefs: version.referenceImagePaths.map((path, index) => ({
          type: "project-file" as const,
          path,
          bytes: undefined,
          hash256: version.referenceImageSha256?.[index] })),
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: ownershipResolved
          ? "retain-shared-reference"
          : "blocker-missing-ownership",
        editRoute: `/studio/continuity/${version.assetId}`,
        retainedReason: ownershipResolved
          ? "Base asset reference may be shared across chapters"
          : undefined,
        blockerReason: !ownershipResolved
          ? "Continuity version has no unique explicit chapter ownership"
          : !version.structurallyComplete
            ? "Incomplete structure"
            : undefined };
    });
}

/**
 * Map base assets (character/scene/prop) to protected artifacts
 */
export function projectBaseAssets(
  characters: { id: string; name: string }[],
  scenes: { id: string; name: string }[],
  props: { id: string; name: string }[],
  projectId: string,
  _chapterId?: string
): ArtifactRecord[] {
  const records: ArtifactRecord[] = [];

  characters.forEach((char) => {
    const artId = buildArtifactId("assets", "base-character", char.id);
    records.push({
      id: artId,
      projectId,
      chapterId: undefined,
      stage: "assets",
      kind: "base-character",
      state: "active",
      name: char.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "protected-base-asset",
      editRoute: `/library/characters/${char.id}`,
      retainedReason: "Base character asset - never delete, may need migration" });
  });

  scenes.forEach((scene) => {
    const artId = buildArtifactId("assets", "base-scene", scene.id);
    records.push({
      id: artId,
      projectId,
      chapterId: undefined,
      stage: "assets",
      kind: "base-scene",
      state: "active",
      name: scene.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "protected-base-asset",
      editRoute: `/library/scenes/${scene.id}`,
      retainedReason: "Base scene asset - never delete, may need migration" });
  });

  props.forEach((prop) => {
    const artId = buildArtifactId("assets", "base-prop", prop.id);
    records.push({
      id: artId,
      projectId,
      chapterId: undefined,
      stage: "assets",
      kind: "base-prop",
      state: "active",
      name: prop.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      physicalRefs: [],
      upstreamIds: [],
      downstreamIds: [],
      deletePolicy: "protected-base-asset",
      editRoute: `/library/props/${prop.id}`,
      retainedReason: "Base prop asset - never delete, may need migration" });
  });

  return records;
}

/**
 * Map media files - check ownership and retention policy
 */
export function projectMediaFiles(
  files: ProjectableMediaFile[],
  projectId: string,
  chapterId?: string,
  hasReverseReferences?: boolean
): ArtifactRecord[] {
  return files
    .filter((f) => f.projectId === projectId)
    .map((file) => {
      const artId = buildArtifactId("media-library", "media-file", file.id);
      const isChapterOwned = file.chapterId === chapterId;
      const isShared = !isChapterOwned && hasReverseReferences === false;
      const currentPath = file.relativePath
        ? { type: "project-file" as const, path: file.relativePath }
        : file.url?.startsWith("local-image://") || file.url?.startsWith("local-video://")
          ? { type: "local-media" as const, path: file.url }
          : file.url?.startsWith("project-file://")
            ? { type: "project-file" as const, path: file.url }
            : undefined;
      const legacyPath = !currentPath && file.localPath
        ? { type: "local-media" as const, path: file.localPath }
        : undefined;
      const physicalPath = currentPath ?? legacyPath;

      return {
        id: artId,
        projectId,
        chapterId: file.chapterId,
        stage: "media-library",
        kind: "media-file",
        state: isChapterOwned ? "active" : "active",
        name: file.name,
        createdAt: file.createdAt ?? Date.now(),
        updatedAt: file.updatedAt ?? file.createdAt ?? Date.now(),
        physicalRefs: physicalPath
          ? [
              {
                type: physicalPath.type,
                path: physicalPath.path,
                bytes: file.size,
                hash256: undefined },
            ]
          : [],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: isChapterOwned
          ? "delete-exclusive-downstream"
          : isShared
          ? "retain-shared-reference"
          : "blocker-missing-ownership",
        editRoute: `/media/file/${file.id}`,
        retainedReason: isShared ? "Media not owned by target chapter" : undefined,
        blockerReason: !file.chapterId ? "Missing chapter ownership" : undefined };
    });
}

/**
 * Project all artifacts from a complete store snapshot
 * Returns projected records plus legacy mapping diagnostics
 */
