import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/app/theme-store";
import type { ProductionFlowNodeId, ProductionFlowNodeModel } from "../workflow-node-model";

const NODE_PREVIEW_CLASS = {
  script: "max-h-[560px]",
  scriptPlan: "h-[520px]",
  assets: "max-h-[560px]",
  storyboardTable: "max-h-[430px]",
  storyboard: "max-h-[320px]",
  remotionProduction: "max-h-[520px]",
  workbench: "max-h-[420px]",
} satisfies Record<ProductionFlowNodeId, string>;

export function TextPreview({ node }: { node: ProductionFlowNodeModel }) {
  const theme = useThemeStore((state) => state.theme);
  return (
    <div
      className={cn(
        "workflow-node-markdown-preview nodrag nopan nowheel overflow-y-auto overscroll-contain rounded-md px-3 py-2 text-[13px] leading-6 text-muted-foreground",
        node.id === "scriptPlan" &&
          "py-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/25 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5",
        NODE_PREVIEW_CLASS[node.id],
      )}
    >
      <MdPreview
        className={cn(
          "md-editor-preview-transparent !bg-transparent text-foreground",
          "[&_.md-editor]:!bg-transparent [&_.md-editor-preview]:!bg-transparent [&_.md-editor-preview-wrapper]:!bg-transparent",
          "[&_.md-editor-preview]:!p-0 [&_.md-editor-preview]:text-[13px] [&_.md-editor-preview]:leading-6",
          "[&_.md-editor-preview_h1]:mb-3 [&_.md-editor-preview_h1]:text-lg [&_.md-editor-preview_h1]:leading-7",
          "[&_.md-editor-preview_h2]:mb-2 [&_.md-editor-preview_h2]:mt-3 [&_.md-editor-preview_h2]:text-base [&_.md-editor-preview_h2]:leading-6",
          "[&_.md-editor-preview_h3]:mb-1.5 [&_.md-editor-preview_h3]:mt-2.5 [&_.md-editor-preview_h3]:text-sm [&_.md-editor-preview_h3]:leading-6",
          "[&_.md-editor-preview_p]:my-2 [&_.md-editor-preview_li]:my-1",
          "[&_.md-editor-preview_ul]:my-2 [&_.md-editor-preview_ol]:my-2",
          "[&_.md-editor-preview_table]:my-3 [&_.md-editor-preview_table]:text-[12px]",
          "[&_.md-editor-preview_pre]:my-3 [&_.md-editor-preview_pre]:max-w-full [&_.md-editor-preview_pre]:overflow-auto",
        )}
        modelValue={buildPreviewMarkdown(node)}
        theme={theme}
        language="zh-CN"
      />
    </div>
  );
}

export function buildPreviewMarkdown(node: ProductionFlowNodeModel) {
  const markdown = node.previewLines.join("\n").trim() || "暂无内容";
  return node.id === "scriptPlan"
    ? unwrapTaggedMarkdown(markdown, "scriptPlan")
    : markdown;
}

function unwrapTaggedMarkdown(markdown: string, tagName: string) {
  const taggedSegments = [...markdown.matchAll(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, "g"))]
    .map((match) => match[1]?.trim())
    .filter((segment): segment is string => Boolean(segment));
  if (taggedSegments.length) return taggedSegments.join("\n\n");

  const withoutLooseTags = markdown
    .replace(new RegExp(`</?${tagName}>`, "g"), "")
    .trim();
  return withoutLooseTags || "暂无内容";
}
