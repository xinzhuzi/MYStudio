import { TextPreview } from "./text-preview";
import type { ProductionFlowNodeModel } from "../workflow-node-model";

export function StoryboardTablePreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const rows = node.tableRows ?? [];
  if (!rows.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nowheel max-h-[430px] overflow-auto overscroll-contain rounded-md bg-muted/10">
      <div className="sticky top-0 z-10 grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] bg-muted text-[10px] font-medium text-foreground">
        <span className="px-2 py-2">序号</span>
        <span className="px-2 py-2">标题</span>
        <span className="px-2 py-2">title</span>
        <span className="px-2 py-2">画面描述</span>
        <span className="px-2 py-2">场景</span>
        <span className="px-2 py-2">关联资产名称</span>
        <span className="px-2 py-2">时长</span>
        <span className="px-2 py-2">景别</span>
        <span className="px-2 py-2">运镜</span>
        <span className="px-2 py-2">角色动作</span>
        <span className="px-2 py-2">朝向</span>
        <span className="px-2 py-2">空间关系</span>
        <span className="px-2 py-2">情绪</span>
        <span className="px-2 py-2">台词</span>
        <span className="px-2 py-2">音效</span>
        <span className="px-2 py-2">关联资产ID</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={`${node.id}-row-${row.index}`}
            className="grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] text-[10px] leading-4 text-muted-foreground odd:bg-muted/35"
          >
            <span className="px-2 py-2 text-foreground">{row.index}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.title || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.titleEn || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.description || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.scene || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.associateAssetsNames.join("、") || "—"}</span>
            <span className="px-2 py-2">{row.duration || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.shotSize || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.cameraMove || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.action || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.orientation || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.spatialRelation || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.emotion || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.lines || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.sound || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.associateAssetsIds.join("、") || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
