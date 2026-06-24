import type { Tab } from "@/stores/media-panel-store";

export const OVERVIEW_WORKFLOW_GUIDE = {
  title: "开始制作",
  summary:
    "从工作流进入当前章节制作；风格、小说、剧本、资产、分镜、配音和剪辑都在工作流页内按阶段推进。",
  primaryAction: {
    label: "进入工作流",
    targetTab: "studio" as Tab,
  },
  secondaryAction: {
    label: "查看资产库",
    targetTab: "assets" as Tab,
  },
};
