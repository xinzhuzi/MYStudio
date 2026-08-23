import { GitBranch, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ImageWorkflowGraph,
  ImageWorkflowOpenContext,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import {
  assetTargetLabel,
  isAssetOpenContext,
} from "./image-workflow-graph-utils";
import {
  ImageWorkflowPaletteImageButton,
  ImageWorkflowPaletteSection,
} from "./image-workflow-palette";

interface ImageWorkflowSidebarProps {
  activeGraph: ImageWorkflowGraph;
  projectName: string;
  initialAssetContext?: ImageWorkflowOpenContext;
  isScopedWorkflowDetail: boolean;
  sourceLabel: string;
  sourceStageLabel?: string;
  workflowWritebackTargetLabel: string;
  storyboards: StoryboardItem[];
  targetStoryboardId: string;
  onTargetStoryboardChange: (value: string) => void;
  onBindTargetStoryboard: () => void;
  canUseGlobalWorkflowControls: boolean;
  imageMaterials: StudioMaterial[];
  storyboardImages: StoryboardItem[];
  onAddReferenceFromMaterial: (material: StudioMaterial) => void;
  onAddReferenceFromStoryboard: (storyboard: StoryboardItem) => void;
  /** scoped 单镜视图切换分镜:选中即走整条打开链(匹配/新建/装配) */
  onSwitchScopedStoryboard?: (storyboard: StoryboardItem) => void;
}

export function ImageWorkflowSidebar({
  activeGraph,
  projectName,
  initialAssetContext,
  isScopedWorkflowDetail,
  sourceLabel,
  sourceStageLabel,
  workflowWritebackTargetLabel,
  storyboards,
  targetStoryboardId,
  onTargetStoryboardChange,
  onBindTargetStoryboard,
  canUseGlobalWorkflowControls,
  imageMaterials,
  storyboardImages,
  onAddReferenceFromMaterial,
  onAddReferenceFromStoryboard,
  onSwitchScopedStoryboard,
}: ImageWorkflowSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-info" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{activeGraph.name}</h3>
            <p className="text-[11px] text-muted-foreground">{projectName}</p>
          </div>
        </div>
        {isScopedWorkflowDetail ? (
          <div className="mt-3 grid gap-2" data-scoped-image-workflow-summary>
            <div className="rounded-md border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
              <div className="text-[10px] uppercase tracking-[0.18em] text-info/70">来源</div>
              <div className="mt-1 truncate">
                {sourceStageLabel ? `${sourceStageLabel} / ${sourceLabel}` : sourceLabel}
              </div>
            </div>
            <div className="rounded-md border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
              <div className="text-[10px] uppercase tracking-[0.18em] text-info/70">回写目标</div>
              <div className="mt-1 truncate">{workflowWritebackTargetLabel}</div>
            </div>
            {onSwitchScopedStoryboard ? (
              <select
                data-scoped-storyboard-switcher
                value={initialAssetContext?.target.kind === "storyboard" ? initialAssetContext.target.id : ""}
                onChange={(event) => {
                  const next = storyboards.find((item) => item.id === event.target.value);
                  if (next && next.id !== (initialAssetContext?.target as { id?: string } | undefined)?.id) {
                    onSwitchScopedStoryboard(next);
                  }
                }}
                className="h-8 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
                title="切换到其他分镜的工作流(选中即切换)"
              >
                <option value="">切换分镜…</option>
                {storyboards.map((storyboard) => (
                  <option key={storyboard.id} value={storyboard.id}>
                    分镜 {storyboard.index} · {(storyboard.videoDesc || storyboard.prompt).slice(0, 18)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : activeGraph.target.kind === "asset" ? (
          <div className="mt-3 rounded-md border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
            <div className="text-[10px] uppercase tracking-[0.18em] text-info/70">回写目标</div>
            <div className="mt-1 truncate">
              {assetTargetLabel(
                activeGraph.target,
                isAssetOpenContext(initialAssetContext) ? initialAssetContext : undefined,
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {onSwitchScopedStoryboard ? (
              <select
                data-storyboard-workflow-switcher
                value=""
                onChange={(event) => {
                  const next = storyboards.find((item) => item.id === event.target.value);
                  if (next) onSwitchScopedStoryboard(next);
                }}
                className="h-8 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
                title="打开所选分镜的图片工作流(选中即切换)"
              >
                <option value="">切换分镜工作流…</option>
                {storyboards.map((storyboard) => (
                  <option key={storyboard.id} value={storyboard.id}>
                    分镜 {storyboard.index} · {(storyboard.videoDesc || storyboard.prompt).slice(0, 18)}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={targetStoryboardId}
              onChange={(event) => onTargetStoryboardChange(event.target.value)}
              className="h-8 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
              title="改变当前工作流的回写目标(选定后需点「绑定当前图」)"
            >
              <option value="">改绑回写分镜(选定后点绑定)</option>
              {storyboards.map((storyboard) => (
                <option key={storyboard.id} value={storyboard.id}>
                  分镜 {storyboard.index} · {storyboard.prompt.slice(0, 18)}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={onBindTargetStoryboard} disabled={!targetStoryboardId}>
              <Save className="h-3.5 w-3.5" />
              绑定当前图
            </Button>
          </div>
        )}
      </div>
      {canUseGlobalWorkflowControls ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ImageWorkflowPaletteSection title="项目参考图" emptyText="当前项目暂无参考图">
            {imageMaterials.slice(0, 24).map((material) => (
              <ImageWorkflowPaletteImageButton
                key={material.id}
                title={material.name}
                imageUrl={material.localPath}
                onClick={() => onAddReferenceFromMaterial(material)}
              />
            ))}
          </ImageWorkflowPaletteSection>
          <ImageWorkflowPaletteSection title="分镜成图" emptyText="分镜尚未绑定图片">
            {storyboardImages.slice(0, 24).map((storyboard) => (
              <ImageWorkflowPaletteImageButton
                key={storyboard.id}
                title={`分镜 ${storyboard.index}`}
                imageUrl={storyboard.mediaRef!.path}
                onClick={() => onAddReferenceFromStoryboard(storyboard)}
              />
            ))}
          </ImageWorkflowPaletteSection>
        </div>
      ) : null}
    </aside>
  );
}
