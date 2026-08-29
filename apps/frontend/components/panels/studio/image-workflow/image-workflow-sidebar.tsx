import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ImageWorkflowSwitcher } from "./image-workflow-switcher";
import { splitImageMaterialsByOrigin } from "./image-workflow-graph-utils";
import type { ImageWorkflowScope } from "./image-workflow-scope";
import {
  ImageWorkflowPaletteImageButton,
  ImageWorkflowPaletteSection,
} from "./image-workflow-palette";
import type {
  ImageWorkflowGraph,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";

/**
 * 图像工作流侧栏(08-30 精简裁定:去小标题堆叠):
 * 顶部=切换器(唯一导航);scoped 分镜域不带参考面板。
 * 原「标题+项目名 / 来源 / 回写目标」小标题卡全部移除——上下文由切换器
 * 本身表达(分镜域=分镜 N;建流等待视图另有来源/回写目标)。
 */
interface ImageWorkflowSidebarProps {
  scope: ImageWorkflowScope;
  activeGraph: ImageWorkflowGraph;
  storyboards: StoryboardItem[];
  imageWorkflows: ImageWorkflowGraph[];
  /** 首帧减负:切换器完整列表延后一帧再挂 */
  chromeReady: boolean;
  onSelectStoryboard: (storyboard: StoryboardItem) => void;
  onSelectWorkflow: (workflowId: string) => void;
  canUseGlobalWorkflowControls: boolean;
  imageMaterials: StudioMaterial[];
  storyboardImages: StoryboardItem[];
  onAddReferenceFromMaterial: (material: StudioMaterial) => void;
  onAddReferenceFromStoryboard: (storyboard: StoryboardItem) => void;
}

export function ImageWorkflowSidebar({
  scope,
  activeGraph,
  storyboards,
  imageWorkflows,
  chromeReady,
  onSelectStoryboard,
  onSelectWorkflow,
  canUseGlobalWorkflowControls,
  imageMaterials,
  storyboardImages,
  onAddReferenceFromMaterial,
  onAddReferenceFromStoryboard,
}: ImageWorkflowSidebarProps) {
  // T3 语义分组:材料库按成图回流(gen-/up4x- 前缀)拆「工作流成图」,
  // 其余归「资产设定图」;分组与分镜成图三段并列
  const { assetReferences, workflowOutputs } = splitImageMaterialsByOrigin(imageMaterials);
  // 分镜背景故事(08-30 裁定):只讲当前分镜的故事,放侧栏即可,不加小标题
  const activeStoryboard = scope === "storyboard" && activeGraph.target.kind === "storyboard"
    ? storyboards.find((item) => item.id === activeGraph.target.id)
    : undefined;
  const storyboardStory = activeStoryboard
    ? (activeStoryboard.videoDesc || activeStoryboard.prompt || "").trim()
    : "";
  const storyBlock = storyboardStory ? (
    <p className="nodrag nopan mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
      {storyboardStory}
    </p>
  ) : null;
  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-3">
        <ImageWorkflowSwitcher
          scope={scope}
          activeGraph={activeGraph}
          storyboards={storyboards}
          imageWorkflows={imageWorkflows}
          chromeReady={chromeReady}
          onSelectStoryboard={onSelectStoryboard}
          onSelectWorkflow={onSelectWorkflow}
        />
        {storyBlock}
      </div>
      {canUseGlobalWorkflowControls ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-image-workflow-reference-palette>
          {assetReferences.length === 0 && workflowOutputs.length === 0 ? (
            <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
              当前项目暂无参考图
            </div>
          ) : null}
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
        className="mb-2 flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-card-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}
