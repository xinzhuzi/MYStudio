// 章节作用域产物路径布局的单一事实源(渲染端;主进程同样可经 @/lib 引用)。
//
// 布局约定(全仓一致):
//   workflow-images/<chapterId>/<workflowId>/<file>          分镜工作流(storyboard 目标)
//   workflow-images/<workflowId>/<file>                      自由/资产工作流(无章节)
//   workflow-images/assets/<chapterId>/<assetType>/<file>    章节独占衍生资产
//   workflow-images/assets/<assetType>/<file>                基类共享资产
//   video-use/<chapterId>/r<rev>/                            主进程 owner: video-workflow-artifact-store
//   remotion/{audio,chapters,outputs,jobs,evidence}/<chapterId>/  主进程 owner: remotion-*-service / remotion-current-paths
//   novel/chapters/<chapterId>.md                            owner: lib/studio/novel
//   novel/source-bible.md                                    owner: lib/studio/source-bible
//
// 清洗策略刻意不统一:本模块的 safePathSegment 是渲染端宽容替换(允许中文,改写非法字符);
// 主进程 IPC 边界的 fail-closed 校验器(video-workflow-artifact-store 的 safeSegment、
// remotion-chapter-manifest-service 的 parseId)必须拒绝而非改写,不在此处合并。
import type { ImageWorkflowTarget, StoryboardItem } from "@/types/studio";

export function safePathSegment(value: string, fallback = "file") {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

export function workflowImageRelativePath(workflowId: string, filename: string, chapterId?: string) {
  // 章节作用域:storyboard 工作流落在 workflow-images/<chapterId>/<workflowId>/,
  // 与 video-use/remotion/audio 的 <类别>/<chapterId>/ 约定对齐;
  // 无章节(free/material/asset)维持历史平铺 workflow-images/<workflowId>/。
  const chapterScope = chapterId ? `${safePathSegment(chapterId)}/` : "";
  return `workflow-images/${chapterScope}${safePathSegment(workflowId)}/${safePathSegment(filename)}`;
}

export function chapterScopeForWorkflowTarget(
  target: ImageWorkflowTarget | undefined,
  storyboards: ReadonlyArray<Pick<StoryboardItem, "id" | "episodeId">> | undefined,
): string | undefined {
  if (target?.kind !== "storyboard") return undefined;
  // storyboards 缺失(异常 store 形态)时降级为历史平铺布局,不让生图链路崩溃
  return storyboards?.find((storyboard) => storyboard.id === target.id)?.episodeId || undefined;
}

export function assetImageRelativePath(
  assetType: string,
  filename: string,
  scope: { chapterId?: string; isDerivative: boolean },
) {
  // 章节独占衍生资产按章节落位(inventory 据路径 chapter-N 判定章节所有权);
  // 基类资产即使误传 chapterId 也强制共享目录,避免被章节删除误伤。
  // filename 视为调用方已预清洗的合成名,直通不重洗(重洗会把超长组合名截断)
  const chapterScope = scope.chapterId && scope.isDerivative ? `${safePathSegment(scope.chapterId)}/` : "";
  return `workflow-images/assets/${chapterScope}${safePathSegment(assetType)}/${filename}`;
}
