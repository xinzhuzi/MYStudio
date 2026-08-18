/**
 * ArtifactCenter 纯函数工具集 — 从 ArtifactCenter.tsx 拆出(Child 2 R3)。
 *
 * 这些函数无 React 依赖、无副作用,提取到独立文件便于单测与复用,
 * 同时降低 ArtifactCenter.tsx(原 1131 行)的主文件行数。
 */
import type { ArtifactRecord, ArtifactState } from "@/types/artifacts";
import { normalizeArtifactPhysicalPath } from "@/lib/artifacts/physical-path";
import { STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import { sharedResourceBucketId, SHARED_BUCKET_PREFIX } from "@/lib/artifacts/project-layout";
import type { ArtifactFileTreeNode } from "./ArtifactTree";

// ── 文件树构建与查询 ──────────────────────────────────────────

export function buildArtifactFileTree(artifacts: ArtifactRecord[]): ArtifactFileTreeNode[] {
  type MutableNode = ArtifactFileTreeNode & { childMap: Map<string, MutableNode> };
  const roots = new Map<string, MutableNode>();

  for (const artifact of artifacts) {
    for (const ref of artifact.physicalRefs) {
      const physicalPath = normalizeArtifactPhysicalPath(ref.path, artifact.projectId);
      if (!physicalPath) continue;
      const parts = physicalPath.split("/").filter(Boolean);
      let children = roots;
      let currentPath = "";
      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isFile = index === parts.length - 1;
        let node = children.get(part);
        if (!node) {
          node = {
            path: currentPath,
            name: part,
            type: isFile ? "file" : "directory",
            artifactIds: [],
            bytes: 0,
            childMap: new Map(),
          };
          children.set(part, node);
        }
        if (isFile) {
          if (!node.artifactIds?.includes(artifact.id)) node.artifactIds?.push(artifact.id);
          node.bytes = (node.bytes ?? 0) + (ref.bytes ?? artifact.bytes ?? 0);
        }
        children = node.childMap;
      });
    }
  }

  const finalize = (nodes: Map<string, MutableNode>): ArtifactFileTreeNode[] => [...nodes.values()]
    .sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1)
    .map((node) => {
      const children = node.type === "directory" ? finalize(node.childMap) : undefined;
      return {
        path: node.path,
        name: node.name,
        type: node.type,
        artifactIds: node.artifactIds,
        bytes: node.type === "directory"
          ? children?.reduce((total, child) => total + (child.bytes ?? 0), node.bytes ?? 0)
          : node.bytes,
        children,
      };
    });

  return finalize(roots);
}

export function findFileTreeNode(nodes: ArtifactFileTreeNode[], directoryPath: string): ArtifactFileTreeNode | null {
  if (!directoryPath) return null;
  for (const node of nodes) {
    if (node.path === directoryPath) return node;
    const nested = node.children ? findFileTreeNode(node.children, directoryPath) : null;
    if (nested) return nested;
  }
  return null;
}

export function fileTreeContainsArtifact(node: ArtifactFileTreeNode, artifactIds: Set<string>): boolean {
  if (node.artifactIds?.some((id) => artifactIds.has(id))) return true;
  return node.children?.some((child) => fileTreeContainsArtifact(child, artifactIds)) ?? false;
}

export function countFileTreeArtifacts(node: ArtifactFileTreeNode): number {
  const ids = new Set<string>();
  const collect = (entry: ArtifactFileTreeNode) => {
    entry.artifactIds?.forEach((id) => ids.add(id));
    entry.children?.forEach(collect);
  };
  collect(node);
  return ids.size;
}

export function parentDirectory(directoryPath: string): string {
  const slash = directoryPath.lastIndexOf("/");
  return slash === -1 ? "" : directoryPath.slice(0, slash);
}

// ── 章节推断与合成桶 ──────────────────────────────────────────

const CHAPTER_PATH_PATTERN = /chapter-[0-9a-z]+/i;

export function inferChapterId(artifact: ArtifactRecord): string | null {
  if (artifact.chapterId) return artifact.chapterId;
  for (const ref of artifact.physicalRefs) {
    const physicalPath = normalizeArtifactPhysicalPath(ref.path, artifact.projectId);
    if (!physicalPath) continue;
    const match = physicalPath.match(CHAPTER_PATH_PATTERN);
    if (match) return match[0];
  }
  return null;
}

export const BACKUP_BUCKET_ID = "__backup__";
export const NONE_BUCKET_ID = "__none__";

/**
 * 统一分桶(左树与表格过滤同源,防漂移):
 * 备份 > 公共资源根(assets/store,优先于章号推断——store 章分片不属章节)>
 * 章号推断 > 杂项。
 */
export function artifactBucketId(artifact: ArtifactRecord): string {
  if (isBackupOnlyArtifact(artifact)) return BACKUP_BUCKET_ID;
  for (const ref of artifact.physicalRefs) {
    const physicalPath = normalizeArtifactPhysicalPath(ref.path, artifact.projectId);
    if (!physicalPath) continue;
    const shared = sharedResourceBucketId(physicalPath);
    if (shared) return shared;
  }
  return inferChapterId(artifact) ?? NONE_BUCKET_ID;
}

export function chapterIdForDeletionPlan(selectedChapterId: string): string {
  return selectedChapterId === NONE_BUCKET_ID
    || selectedChapterId === BACKUP_BUCKET_ID
    || selectedChapterId.startsWith(SHARED_BUCKET_PREFIX)
    ? ""
    : selectedChapterId;
}

export function isBackupOnlyArtifact(artifact: ArtifactRecord): boolean {
  if (artifact.physicalRefs.length === 0) return false;
  return artifact.physicalRefs.every((ref) => ref.type === "backup");
}

export function formatChapterLabel(id: string): string {
  const digitMatch = id.match(/(\d+)/);
  if (digitMatch) {
    const num = parseInt(digitMatch[1], 10);
    return `第 ${num} 章`;
  }
  return `第 ${id} 章`;
}

// ── 格式化 ──────────────────────────────────────────────────

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const STATE_LABELS: Record<ArtifactState, string> = {
  "active": "活跃",
  "archived": "已归档",
  "orphaned": "孤儿",
  "blocked": "已阻塞",
  "unknown": "未知",
};

export { STATE_LABELS };

export function formatArtifactTooltip(artifact: ArtifactRecord): string {
  const stageLabel = STAGE_LABELS[artifact.stage] || artifact.stage;
  const stateLabel = STATE_LABELS[artifact.state] || artifact.state;
  const updated = new Date(artifact.updatedAt).toLocaleString('zh-CN');
  const created = new Date(artifact.createdAt).toLocaleString('zh-CN');
  const chapter = artifact.chapterId
    ? formatChapterLabel(artifact.chapterId)
    : '根目录';
  const tags = artifact.metadata?.tags?.length
    ? artifact.metadata.tags.join('、')
    : '无';
  const notes = artifact.metadata?.notes?.trim() || '无';
  const lines = [
    `名称:${artifact.name}`,
    `类型:${artifact.kind}`,
    `阶段:${stageLabel}`,
    `状态:${stateLabel}`,
    `章节:${chapter}`,
    `大小:${formatBytes(artifact.bytes)}`,
    `更新:${updated}`,
    `创建:${created}`,
    `上游依赖:${artifact.upstreamIds.length}  下游引用:${artifact.downstreamIds.length}`,
  ];
  if (artifact.retainedReason) lines.push(`保留原因:${artifact.retainedReason}`);
  if (artifact.blockerReason) lines.push(`阻塞原因:${artifact.blockerReason}`);
  lines.push(`标签:${tags}`);
  lines.push(`备注:${notes}`);
  return lines.join('\n');
}
