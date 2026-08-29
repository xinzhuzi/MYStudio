import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import type { ImageWorkflowScope } from "./image-workflow-scope";

/**
 * 图片工作流切换器(08-30 结构拆分:从工具条抽出,独立成件)。
 * 作用域强隔离——两组永不同框:
 * - storyboard 域:仅「本章分镜」组(值 `sb:<id>`,走分镜切换链恒当前代);
 * - library 域:仅「资产工作流」+「自由工作流」组(值=流 id 直切)。
 * 当前流不在本域列表时(如跨章分镜流)补一项以流名兜底显示,选中不动作。
 * 展示层铁律:不同功能模块分组列出,空组不渲染。
 */
export function ImageWorkflowSwitcher({
  scope,
  activeGraph,
  storyboards,
  imageWorkflows,
  chromeReady,
  onSelectStoryboard,
  onSelectWorkflow,
}: {
  scope: ImageWorkflowScope;
  activeGraph: ImageWorkflowGraph;
  storyboards: StoryboardItem[];
  imageWorkflows: ImageWorkflowGraph[];
  /** 首帧减负:完整列表延后一帧再挂(进入画布瞬间不铺全部 <option>) */
  chromeReady: boolean;
  onSelectStoryboard: (storyboard: StoryboardItem) => void;
  onSelectWorkflow: (workflowId: string) => void;
}) {
  const activeStoryboardId =
    activeGraph.target.kind === "storyboard" && typeof activeGraph.target.id === "string"
      ? activeGraph.target.id
      : null;
  const selectorValue = scope === "storyboard" && activeStoryboardId
    ? `sb:${activeStoryboardId}`
    : activeGraph.id;
  const currentStoryboardMissing =
    scope === "storyboard" && activeStoryboardId !== null
      && !storyboards.some((item) => item.id === activeStoryboardId);
  const libraryGraphs = imageWorkflows.filter((graph) => graph.target.kind !== "storyboard");
  const assetGraphs = libraryGraphs.filter(
    (graph) => graph.target.kind === "asset" || graph.target.kind === "material",
  );
  const freeGraphs = libraryGraphs.filter((graph) => graph.target.kind === "free");
  const storyboardOptionLabel = (storyboard: StoryboardItem) =>
    `分镜 ${storyboard.index} · ${(storyboard.videoDesc || storyboard.prompt).slice(0, 18)}`;

  return (
    <select
      data-image-workflow-selector
      data-image-workflow-active-id={activeGraph.id}
      data-image-workflow-scope={scope}
      value={selectorValue}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue === selectorValue) return;
        if (nextValue.startsWith("sb:")) {
          const storyboard = storyboards.find((item) => `sb:${item.id}` === nextValue);
          if (storyboard) onSelectStoryboard(storyboard);
          return;
        }
        onSelectWorkflow(nextValue);
      }}
      className="h-8 max-w-[260px] cursor-pointer rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none transition-colors hover:border-primary/45 focus-visible:border-primary/55 focus-visible:ring-2 focus-visible:ring-primary/25"
      title={scope === "storyboard" ? "切换本章分镜" : "切换资产或自由工作流"}
      aria-label="切换工作流"
    >
      {chromeReady ? (
        <>
          {scope === "storyboard" ? (
            <optgroup label="本章分镜">
              {storyboards.map((storyboard) => (
                <option key={storyboard.id} value={`sb:${storyboard.id}`}>
                  {storyboardOptionLabel(storyboard)}
                </option>
              ))}
              {currentStoryboardMissing ? (
                <option value={selectorValue}>{activeGraph.name}(其他章节)</option>
              ) : null}
            </optgroup>
          ) : (
            <>
              {assetGraphs.length ? (
                <optgroup label="资产工作流">
                  {assetGraphs.map((graph) => (
                    <option key={graph.id} value={graph.id}>
                      {graph.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {freeGraphs.length ? (
                <optgroup label="自由工作流">
                  {freeGraphs.map((graph) => (
                    <option key={graph.id} value={graph.id}>
                      {graph.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {assetGraphs.length + freeGraphs.length === 0 ? (
                <option value={selectorValue}>{activeGraph.name}</option>
              ) : null}
            </>
          )}
        </>
      ) : (
        <option value={selectorValue}>{activeGraph.name}</option>
      )}
    </select>
  );
}
