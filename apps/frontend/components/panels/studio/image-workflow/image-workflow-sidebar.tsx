import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type {
  ImageWorkflowGraph,
  ImageWorkflowOpenContext,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import {
  assetTargetLabel,
  isAssetOpenContext,
  splitImageMaterialsByOrigin,
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
  canUseGlobalWorkflowControls,
  imageMaterials,
  storyboardImages,
  onAddReferenceFromMaterial,
  onAddReferenceFromStoryboard,
  onSwitchScopedStoryboard,
}: ImageWorkflowSidebarProps) {
  // T3 语义分组:材料库按成图回流(gen-/up4x- 前缀)拆「工作流成图」,
  // 其余归「资产设定图」;分组与分镜成图三段并列
  const { assetReferences, workflowOutputs } = splitImageMaterialsByOrigin(imageMaterials);
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
          </div>
        )}
      </div>
      {canUseGlobalWorkflowControls ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-image-workflow-reference-palette>
          <ReferencePaletteGroup title={`资产设定图 · ${assetReferences.length}`} defaultOpen>
            {assetReferences.map((material) => (
              <ImageWorkflowPaletteImageButton
                key={material.id}
                title={material.name}
                imageUrl={material.localPath}
                onClick={() => onAddReferenceFromMaterial(material)}
              />
            ))}
          </ReferencePaletteGroup>
          <ReferencePaletteGroup title={`工作流成图 · ${workflowOutputs.length}`} defaultOpen>
            {workflowOutputs.map((material) => (
              <ImageWorkflowPaletteImageButton
                key={material.id}
                title={material.name}
                imageUrl={material.localPath}
                onClick={() => onAddReferenceFromMaterial(material)}
              />
            ))}
          </ReferencePaletteGroup>
          <ImageWorkflowPaletteSection
            title={`分镜成图 · ${storyboardImages.length}`}
            emptyText="分镜尚未绑定图片"
          >
            {storyboardImages.map((storyboard) => (
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

/** 参考面板可折叠分组(T3):组多图杂,标题点击收起/展开即组级筛选;空组不渲染。 */
function ReferencePaletteGroup({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const items = Array.isArray(children) ? children : [children];
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <button
        type="button"
        data-image-workflow-palette-group
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mb-2 flex w-full items-center gap-1 text-xs font-semibold text-card-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open ? <div className="grid grid-cols-2 gap-2">{children}</div> : null}
    </section>
  );
}
