// 项目根目录布局契约表 —— 产物分类(stage)与公共资源分组的单一事实源。
// 与磁盘布局对齐(store v1 / hyperframes 独立根 / workflow-images 章节化 / backups 收口),
// 路径布局本身见 @/lib/studio/chapter-paths 头部契约。
//
// chapterScoped: 该根下产物按 chapter-XXX/ 子目录组织(参与章节分桶);
// sharedLabel:   公共资源分组显示名(设定:公共资源判定优先于章号推断,
//                如 store/studio-workflow/chapters/chapter-001.json 属"项目存储"
//                而非第 1 章)。
import type { ArtifactStage } from "@/types/artifacts";

export interface ProjectRootLayoutEntry {
  stage: ArtifactStage;
  chapterScoped: boolean;
  sharedLabel?: string;
}

export const PROJECT_ROOT_LAYOUT: Record<string, ProjectRootLayoutEntry> = {
  "novel": { stage: "novel", chapterScoped: true },
  "continuity-bibles": { stage: "storyboard", chapterScoped: true },
  "workflow-images": { stage: "image", chapterScoped: true },
  "video-use": { stage: "production", chapterScoped: true },
  "hyperframes": { stage: "production", chapterScoped: true },
  "remotion": { stage: "remotion", chapterScoped: true },
  "exports": { stage: "export", chapterScoped: true },
  "assets": { stage: "assets", chapterScoped: false, sharedLabel: "设定集素材" },
  "store": { stage: "project-store", chapterScoped: false, sharedLabel: "项目存储" },
};

/** 未匹配根目录的兜底 stage(保持历史行为) */
export const FALLBACK_ROOT_STAGE: ArtifactStage = "media-library";

/** 按项目相对路径的首段查契约表;深层路径(remotion/outputs/...)首段即根 */
export function classifyProjectRootStage(relativePath: string): ArtifactStage {
  const root = relativePath.split("/")[0];
  return PROJECT_ROOT_LAYOUT[root]?.stage ?? FALLBACK_ROOT_STAGE;
}

/** 公共资源分组桶 id(shared:<root>);非公共根返回 null */
export function sharedResourceBucketId(relativePath: string): string | null {
  const root = relativePath.split("/")[0];
  const entry = PROJECT_ROOT_LAYOUT[root];
  return entry?.sharedLabel ? `shared:${root}` : null;
}

export const SHARED_BUCKET_PREFIX = "shared:";

/** 公共资源桶 id → 显示名 */
export function sharedBucketLabel(bucketId: string): string | null {
  if (!bucketId.startsWith(SHARED_BUCKET_PREFIX)) return null;
  return PROJECT_ROOT_LAYOUT[bucketId.slice(SHARED_BUCKET_PREFIX.length)]?.sharedLabel ?? null;
}
