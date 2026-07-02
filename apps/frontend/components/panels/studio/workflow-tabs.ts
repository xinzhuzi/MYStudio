import {
  BookMarked,
  BookOpen,
  Boxes,
  FileText,
  Film,
  Image,
  Split,
} from "lucide-react";

export const WORKFLOW_TABS = [
  { value: "manuals", label: "风格与导演", Icon: BookMarked },
  { value: "novel", label: "小说导入", Icon: BookOpen },
  { value: "script", label: "剧本生产阶段", Icon: FileText },
  { value: "assets", label: "剧本资产管理", Icon: Boxes },
  { value: "storyboard", label: "分镜视频生成", Icon: Split },
  { value: "imageWorkflow", label: "图像节点图", Icon: Image },
  { value: "workbench", label: "视频工作台", Icon: Film },
];

const VISIBLE_WORKFLOW_STAGES = new Set(WORKFLOW_TABS.map((tab) => tab.value));

export function resolveVisibleWorkflowStage(stage?: string): string {
  if (stage === "generation") return "assets";
  if (stage === "flow") return "storyboard";
  return stage && VISIBLE_WORKFLOW_STAGES.has(stage) ? stage : "manuals";
}
