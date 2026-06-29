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
  stages: [
    {
      title: "风格与导演",
      targetStage: "manuals",
      summary: "选择视觉手册、导演手册和项目基础参数。",
    },
    {
      title: "小说导入",
      targetStage: "novel",
      summary: "按章节导入原文，保留章节边界和原始文本。",
    },
    {
      title: "策划编剧",
      targetStage: "script",
      summary: "生成故事骨架、改编策略、剧本草稿和审核修订。",
    },
    {
      title: "剧本资产提取",
      targetStage: "assets",
      summary: "抽取角色、场景、道具，形成后续制作资产清单。",
    },
    {
      title: "剧本资产管理",
      targetStage: "generation",
      summary: "管理角色、场景、道具和衍生资产制作状态。",
    },
    {
      title: "分镜视频生成",
      targetStage: "storyboard",
      summary: "绑定画面素材、台词、音色和分镜图。",
    },
    {
      title: "视频工作台",
      targetStage: "workbench",
      summary: "生成候选片段，选择版本并导出成片。",
    },
  ],
};
