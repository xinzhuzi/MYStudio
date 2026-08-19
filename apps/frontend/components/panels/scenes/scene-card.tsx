import {
  ATMOSPHERE_PRESETS,
  TIME_PRESETS,
  type Scene,
} from "@/stores/library/scene-store";
import { cn } from "@/lib/utils";
import { useResolvedImageUrl } from "@/hooks/use-resolved-image-url";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  MapPin,
  Sun,
  Wind,
} from "lucide-react";

export type SceneCardViewMode = "grid" | "list";

export function SceneCard({
  scene,
  isSelected,
  viewMode,
  onClick,
  depth = 0,
  childCount = 0,
  isExpanded = false,
  hasChildren = false,
  onToggleExpand,
  onImagePreview,
  generatingTask,
}: {
  scene: Scene;
  isSelected: boolean;
  viewMode: SceneCardViewMode;
  onClick: () => void;
  depth?: number;         // 嵌套层级
  childCount?: number;    // 子场景数量
  isExpanded?: boolean;   // 是否展开
  hasChildren?: boolean;  // 是否有子场景
  onToggleExpand?: () => void;
  onImagePreview?: (url: string) => void;
  generatingTask?: { status: string; progress: number; message?: string };
}) {
  const timeLabel = TIME_PRESETS.find(t => t.id === scene.time)?.label || scene.time;
  const atmosphereLabel = ATMOSPHERE_PRESETS.find(a => a.id === scene.atmosphere)?.label || scene.atmosphere;
 
  // Use referenceImage first, fall back to contactSheetImage for parent scenes
  const displayImage = scene.referenceImage || scene.contactSheetImage || undefined;
  const resolvedImage = useResolvedImageUrl(displayImage);
  
  // 根据层级计算缩进
  const indentStyle = { marginLeft: `${depth * 20}px` };

  if (viewMode === "grid") {
    return (
      <div
        style={indentStyle}
        className={cn(
          "rounded-md border cursor-pointer transition-all p-2",
          "hover:border-foreground/30",
          isSelected && "border-primary ring-1 ring-primary",
          depth > 0 && "border-dashed border-muted-foreground/50"
        )}
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (hasChildren) {
            onToggleExpand?.();
          }
        }}
      >
        <div
          className={cn(
            "aspect-video rounded bg-muted flex items-center justify-center overflow-hidden mb-2 relative",
            hasChildren ? "cursor-pointer" : "cursor-zoom-in"
          )}
          title={hasChildren ? (isExpanded ? "双击收起子场景" : "双击展开子场景") : "双击查看大图"}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              // 有子场景时，双击展开/收起而非打开预览
              onToggleExpand?.();
            } else {
              if (resolvedImage) onImagePreview?.(resolvedImage);
            }
          }}
        >
          {displayImage ? (
            <img 
              src={resolvedImage || ''} 
              alt={scene.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <MapPin className="h-8 w-8 text-muted-foreground" />
          )}
          {/* 联合图生成中遮罩 */}
          {generatingTask && generatingTask.status !== 'done' && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1 z-10">
              {generatingTask.status === 'error' ? (
                <span className="text-destructive text-[10px]">❌ 失败</span>
              ) : (
                <>
                  <Loader2 className="h-6 w-6 text-foreground animate-spin" />
                  <span className="text-foreground text-[10px]">{generatingTask.message || '生成中...'}</span>
                  <div className="w-3/4 h-1 bg-white/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${generatingTask.progress}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          {/* 子场景标识 */}
          {depth > 0 && (
            <div className="absolute top-1 left-1 bg-primary text-white text-[8px] px-1 py-0.5 rounded">
              {scene.viewpointName || '视角'}
            </div>
          )}
          {/* 显示子场景数量 + 展开/收起指示 */}
          {hasChildren && (
            <div
              className={cn(
                "absolute top-1 right-1 px-1.5 py-0.5 rounded text-white text-[8px] flex items-center gap-0.5 cursor-pointer",
                isExpanded ? "bg-primary" : "bg-success"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              title={isExpanded ? "收起子场景" : "展开子场景"}
            >
              {isExpanded ? (
                <ChevronDown className="h-2.5 w-2.5" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5" />
              )}
              {childCount} 个
            </div>
          )}
          {/* 父场景预览按钮（有子场景时双击展开，预览通过此按钮） */}
          {hasChildren && resolvedImage && (
            <div
              className="absolute bottom-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded p-0.5 cursor-pointer transition-colors"
              title="预览大图"
              onClick={(e) => {
                e.stopPropagation();
                onImagePreview?.(resolvedImage);
              }}
            >
              <Eye className="h-3 w-3" />
            </div>
          )}
        </div>
        <div>
          <p className="text-sm font-medium truncate">
            {depth > 0 ? `└ ${scene.viewpointName || scene.name}` : scene.name}
          </p>
          <div className="flex items-center gap-1 mt-1">
            {depth === 0 ? (
              <>
                <span className="text-[10px] bg-muted px-1 py-0.5 rounded flex items-center gap-0.5">
                  <Sun className="h-2.5 w-2.5" />
                  {timeLabel}
                </span>
                <span className="text-[10px] bg-muted px-1 py-0.5 rounded flex items-center gap-0.5">
                  <Wind className="h-2.5 w-2.5" />
                  {atmosphereLabel}
                </span>
              </>
            ) : (
              <span className="text-[10px] bg-primary/15 text-primary px-1 py-0.5 rounded">
                {scene.viewpointName || '视角'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div
      style={indentStyle}
      className={cn(
        "rounded-md border cursor-pointer transition-all p-2 flex items-center gap-2",
        "hover:border-foreground/30",
        isSelected && "border-primary ring-1 ring-primary",
        depth > 0 && "border-dashed border-muted-foreground/50"
      )}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (hasChildren) {
          onToggleExpand?.();
        }
      }}
    >
      {/* 展开/收起指示器 */}
      {hasChildren ? (
        <ChevronRight className={cn(
          "h-4 w-4 transition-transform text-muted-foreground flex-shrink-0",
          isExpanded && "rotate-90"
        )} />
      ) : (
        <div className="w-4" /> // 占位
      )}
      
      <div className="w-16 h-10 rounded bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 relative">
        {displayImage ? (
          <img 
            src={resolvedImage || ''} 
            alt={scene.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <MapPin className="h-4 w-4 text-muted-foreground" />
        )}
        {/* 列表视图生成中遮罩 */}
        {generatingTask && generatingTask.status !== 'done' && generatingTask.status !== 'error' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="h-4 w-4 text-foreground animate-spin" />
          </div>
        )}
        {depth > 0 && (
          <div className="absolute top-0 left-0 bg-primary text-white text-[6px] px-0.5 rounded-br">
            视角
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {depth > 0 ? `└ ${scene.viewpointName || scene.name}` : scene.name}
        </p>
        {generatingTask && generatingTask.status !== 'done' ? (
          <p className="text-xs text-warning truncate flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {generatingTask.message || '生成中...'}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground truncate">
            {depth > 0 ? `🎯 ${scene.viewpointName || '视角'}` : `📍 ${scene.location}`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] flex-shrink-0">
        {depth === 0 ? (
          <>
            <span className="bg-muted px-1 py-0.5 rounded">{timeLabel}</span>
            {hasChildren && (
              <span className="bg-success/15 text-success px-1 py-0.5 rounded">{childCount} 个</span>
            )}
          </>
        ) : (
          <span className="bg-primary/15 text-primary px-1 py-0.5 rounded">视角</span>
        )}
      </div>
    </div>
  );
}

