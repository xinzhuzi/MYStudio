/**
 * ArtifactCenter 派生逻辑——过滤排序/项目树/章节分桶三段纯函数。
 * 08-31 file-size-reduction P2 拆出,memo 体逐字保留(参数名=原闭包变量)。
 */
import type { ArtifactRecord, ArtifactStage, ArtifactState } from "@/types/artifacts";
import { FIXED_NAV_STAGES, STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import { sharedBucketLabel, SHARED_BUCKET_PREFIX } from "@/lib/artifacts/project-layout";
import type { ArtifactChapterTreeNode, ArtifactTreeProject } from "./ArtifactTree";
import { artifactBucketId, buildArtifactFileTree, formatChapterLabel, NONE_BUCKET_ID, BACKUP_BUCKET_ID } from "./artifact-center-utils";

export function filterAndSortArtifacts(
  artifacts: ArtifactRecord[],
  fileNavigationActive: boolean,
  selectedChapterId: string | null,
  stageFilter: ArtifactStage | "all",
  stateFilter: ArtifactState | "all",
  sortBy: keyof ArtifactRecord,
  sortOrder: "asc" | "desc",
): ArtifactRecord[] {
    let result = [...artifacts];

    // Chapter filter. Must mirror how the left chapter column is grouped
    // (inferChapterId, with "__none__" for ungrouped), otherwise inferred-
    // chapter artifacts are counted in the column but filtered out of the
    // table. See chapters useMemo and inferChapterId.
    if (selectedChapterId && !fileNavigationActive) {
      // 与 chapters useMemo 同源(artifactBucketId),防分桶/过滤漂移
      result = result.filter(a => artifactBucketId(a) === selectedChapterId);
    }

    // Stage filter
    if (stageFilter !== 'all') {
      result = result.filter(a => a.stage === stageFilter);
    }

    // State filter
    if (stateFilter !== 'all') {
      result = result.filter(a => a.state === stateFilter);
    }

    // Sort
    result.sort((a, b) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let valueA: any = a[sortBy];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let valueB: any = b[sortBy];

      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        valueA = new Date(valueA).getTime();
        valueB = new Date(valueB).getTime();
      } else if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase();
        valueB = valueB.toLowerCase();
      }

      if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
}

export function buildTreeProjects(
  artifacts: ArtifactRecord[],
  mockProjects: ArtifactTreeProject[] | undefined,
  projectList: Array<{ id: string; name: string }>,
  activeProjectId: string | null,
): ArtifactTreeProject[] {
    if (mockProjects) {
      return mockProjects.map((project) => ({
        id: project.id,
        name: project.name,
        fileTree: project.fileTree ?? buildArtifactFileTree(artifacts.filter((artifact) => artifact.projectId === project.id)),
        chapters: [],
      }));
    }

    // Aggregate artifact counts by stage, keyed by projectId.
    const stageCountByProject = new Map<string, Map<string, number>>();
    for (const artifact of artifacts) {
      if (!artifact.projectId) continue;
      if (!stageCountByProject.has(artifact.projectId)) {
        stageCountByProject.set(artifact.projectId, new Map());
      }
      const stageMap = stageCountByProject.get(artifact.projectId)!;
      stageMap.set(artifact.stage, (stageMap.get(artifact.stage) ?? 0) + 1);
    }

    // Source projects: real project list from store. Active project is always
    // shown (even with zero artifacts) so the user can tell which is open.
    const sourceProjects = projectList.length > 0
      ? projectList
      : Array.from(stageCountByProject.keys()).map(id => ({ id, name: `项目 ${id.substring(0, 8)}` }));

    return sourceProjects
      .filter(p => p.id === activeProjectId || stageCountByProject.has(p.id))
      .map(project => {
        return {
          id: project.id,
          name: project.name,
          fileTree: buildArtifactFileTree(artifacts.filter((artifact) => artifact.projectId === project.id)),
          chapters: [],
        };
      });
}

export function buildChapterTreeNodes(
  artifacts: ArtifactRecord[],
  activeProjectId: string | null,
): ArtifactChapterTreeNode[] {
    if (!activeProjectId) return [];
    const projectArtifacts = artifacts.filter((artifact) => artifact.projectId === activeProjectId);
    const groups = new Map<string, { count: number; stageCounts: Map<ArtifactStage, number> }>();
    for (const artifact of projectArtifacts) {
      const bucket = artifactBucketId(artifact);
      const group = groups.get(bucket) ?? { count: 0, stageCounts: new Map<ArtifactStage, number>() };
      group.count += 1;
      group.stageCounts.set(artifact.stage, (group.stageCounts.get(artifact.stage) ?? 0) + 1);
      groups.set(bucket, group);
    }
    // 两段式排序:章节(升序) → 公共资源 → 杂项 → 备份(垫底)
    const bucketRank = (id: string): number =>
      id.startsWith(SHARED_BUCKET_PREFIX) ? 1
        : id === NONE_BUCKET_ID ? 2
          : id === BACKUP_BUCKET_ID ? 3
            : 0;
    return [...groups.entries()]
      .sort(([a], [b]) => {
        const ra = bucketRank(a);
        const rb = bucketRank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map(([id, group]) => ({
        id,
        label:
          id === NONE_BUCKET_ID
            ? "杂项"
            : id === BACKUP_BUCKET_ID
              ? "备份"
              : sharedBucketLabel(id) ?? formatChapterLabel(id),
        count: group.count,
        stages: (id.startsWith(SHARED_BUCKET_PREFIX)
          // 公共资源组展示全部出现过的 stage(project-store 不在 FIXED_NAV_STAGES)
          ? [...group.stageCounts.entries()].filter(([, count]) => count > 0).map(([stage, count]) => ({ stage, count }))
          : FIXED_NAV_STAGES.map((stage) => ({ stage, count: group.stageCounts.get(stage) ?? 0 })).filter(({ count }) => count > 0)
        ).map(({ stage, count }) => ({
          id: stage,
          label: STAGE_LABELS[stage],
          count,
        })),
      }));
}
