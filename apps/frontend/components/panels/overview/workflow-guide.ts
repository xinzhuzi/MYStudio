import type { Tab } from "@/stores/media-panel-store";

export type OverviewWorkflowStep = {
  id: number;
  title: string;
  description: string;
  targetTab: Tab;
  actionLabel: string;
};

export const OVERVIEW_WORKFLOW_GUIDE = {
  title: "漫影工作室基础工作流",
  summary:
    "进入工作流第一步先选定视觉手册（画风）与导演手册（决定全剧视觉与镜头基调，与 Toonflow 项目配置一致），再导入小说，把原文整理成上下文、剧本、分镜、素材和制作轨道，最后通过本地 FFmpeg 合成为成片。V1 不依赖大模型也能跑通主流程，模型配置只作为后续接入位置保留。",
  primaryAction: {
    label: "查看所有风格",
    targetTab: "assets" as Tab,
  },
  secondaryAction: {
    label: "查看完整工作流",
    targetTab: "studio" as Tab,
  },
  steps: [
    {
      id: 1,
      title: "风格与导演选择",
      description: "进入工作流第一步，选定视觉手册（画风）与导演手册：画风决定全剧视觉基调，导演手册决定镜头语言与运镜规范，二者作为后续校准、分镜和生成的全局约束（与 Toonflow 的画风/导演设定保持一致）。",
      targetTab: "studio",
      actionLabel: "去选择",
    },
    {
      id: 2,
      title: "小说导入",
      description: "导入 TXT/Markdown 小说，按章节拆分，保留原文并可手动补充事件摘要。",
      targetTab: "studio",
      actionLabel: "去导入",
    },
    {
      id: 3,
      title: "上下文整理",
      description: "把章节原文、事件摘要、项目设定整理成 Skill/任务上下文包，当前版本仅保存整理结果，后续版本将接入 AI 自动处理。",
      targetTab: "studio",
      actionLabel: "去整理",
    },
    {
      id: 4,
      title: "剧本策划",
      description: "基于小说和上下文设计故事骨架、改编策略、剧本草稿和制作计划。",
      targetTab: "studio",
      actionLabel: "去策划",
    },
    {
      id: 5,
      title: "分镜设计",
      description: "把剧本片段拆成分镜表，维护镜头顺序、时长、画面描述、prompt 和素材引用。",
      targetTab: "studio",
      actionLabel: "去分镜",
    },
    {
      id: 6,
      title: "素材管理",
      description: "管理角色、场景、道具、音频、图片和视频片段，并绑定到分镜或制作轨道。",
      targetTab: "assets",
      actionLabel: "去素材",
    },
    {
      id: 7,
      title: "制作剪辑",
      description: "按 track 聚合分镜，生成本地 FFmpeg 候选片段，选择最终片段进入剪辑工作台。",
      targetTab: "studio",
      actionLabel: "去剪辑",
    },
    {
      id: 8,
      title: "合成导出",
      description: "只拼接已选候选视频，处理字幕、音频和片段 concat，输出 episode 成片。",
      targetTab: "export",
      actionLabel: "去导出",
    },
  ] satisfies OverviewWorkflowStep[],
};
