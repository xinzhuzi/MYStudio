// 产物中心「章节整理」的纯逻辑层:扫描旧平铺布局的分镜工作流 → 生成迁移计划 → 深度改写引用。
// 布局契约见 @/lib/studio/chapter-paths:
//   旧(平铺) workflow-images/storyboard-flow-<chapterId>-NNN/
//   新(章节) workflow-images/<chapterId>/storyboard-flow-<chapterId>-NNN/
import type { ImageWorkflowGraph } from "@/types/studio";

/** 旧布局目录名:章节号嵌在工作流 ID 里 */
const LEGACY_FLOW_DIR_RE = /^storyboard-flow-(chapter-\d{3})-[^\s/]+$/;

export interface ChapterMigrationPlanItem {
  flowDir: string; // workflow-images/storyboard-flow-chapter-001-005
  chapterId: string; // chapter-001
  toDir: string; // workflow-images/chapter-001/storyboard-flow-chapter-001-005
  urlCount: number; // 该工作流在 store 中的图片引用数(按 URL 前缀统计)
}

function collectNodeImageUrls(graph: ImageWorkflowGraph): string[] {
  const urls: string[] = [];
  for (const node of graph.nodes) {
    const imageUrl = (node as { imageUrl?: unknown }).imageUrl;
    if (typeof imageUrl === "string" && imageUrl) urls.push(imageUrl);
  }
  return urls;
}

/**
 * 扫描工作流图,挑出图片仍落在旧平铺目录的 storyboard 工作流。
 * 新布局 URL(chapter-paths 产物)与无图/自由工作流天然跳过 → 重复执行幂等。
 */
export function collectLegacyStoryboardFlowPlans(
  graphs: ReadonlyArray<ImageWorkflowGraph>,
): ChapterMigrationPlanItem[] {
  const byFlowDir = new Map<string, ChapterMigrationPlanItem>();
  for (const graph of graphs) {
    const flowDirName = String(graph.id ?? "");
    const match = flowDirName.match(LEGACY_FLOW_DIR_RE);
    if (!match) continue;
    const chapterId = match[1];
    const fromDir = `workflow-images/${flowDirName}`;
    // 只有当存在仍指向旧平铺目录的图片 URL 时才需要迁移(新写入已走章节子树)
    const legacyUrlCount = collectNodeImageUrls(graph).filter(
      (url) => url.includes(`/${fromDir}/`),
    ).length;
    if (legacyUrlCount === 0) continue;
    const existing = byFlowDir.get(fromDir);
    if (existing) {
      existing.urlCount += legacyUrlCount;
      continue;
    }
    byFlowDir.set(fromDir, {
      flowDir: fromDir,
      chapterId,
      toDir: `workflow-images/${chapterId}/${flowDirName}`,
      urlCount: legacyUrlCount,
    });
  }
  return [...byFlowDir.values()].sort((a, b) => a.flowDir.localeCompare(b.flowDir));
}

/**
 * 深度改写 store 中的引用:把字符串里出现的 `workflow-images/<flowDir>/` 前缀
 * 替换为 `workflow-images/<chapterId>/<flowDir>/`。带尾斜杠匹配避免
 * `chapter-001-005` 误吃 `chapter-001-0050` 一类前缀碰撞。
 * 覆盖 imageWorkflows/storyboards/materials/mediaTasks 四类持有方(全 state 深走)。
 */
export function rewriteChapterArtifactReferences<T>(
  value: T,
  plans: ReadonlyArray<ChapterMigrationPlanItem>,
): { value: T; replacedCount: number } {
  let replacedCount = 0;
  const replacements = plans.map((plan) => ({
    from: `${plan.flowDir}/`,
    to: `${plan.toDir}/`,
  }));

  function walk(node: unknown): unknown {
    if (typeof node === "string") {
      let next = node;
      for (const { from, to } of replacements) {
        if (next.includes(from)) {
          next = next.split(from).join(to);
          replacedCount += 1;
        }
      }
      return next;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(child);
      }
      return out;
    }
    return node;
  }

  return { value: walk(value) as T, replacedCount };
}
