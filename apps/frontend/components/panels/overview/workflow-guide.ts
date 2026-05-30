import type { Tab } from "@/stores/media-panel-store";

export type OverviewWorkflowStep = {
  id: number;
  title: string;
  description: string;
  targetTab: Tab;
  actionLabel: string;
};

export const OVERVIEW_WORKFLOW_GUIDE = {
  title: "漫影工作室标准工作流",
  summary:
    "从小说到成片的固定标准流程（见 docs/融合/小说到成片·统一工作流计划）：先选画风与导演手册，再导入小说，经事件分析、剧本策划、实体提取、分镜拆解、一致性资产、音色分配，最后生图生视频并本地 FFmpeg 剪辑成片。短篇可走精简链，长篇走完整深链。",
  primaryAction: {
    label: "查看所有风格",
    targetTab: "assets" as Tab,
  },
  secondaryAction: {
    label: "进入工作流",
    targetTab: "studio" as Tab,
  },
  steps: [
    {
      id: 1,
      title: "风格与导演选择",
      description: "进入工作流第一步，选定视觉手册（画风）与导演手册：画风决定全剧视觉基调，导演手册决定镜头语言与运镜规范，作为后续全局约束（与 Toonflow 一致）。",
      targetTab: "studio",
      actionLabel: "去选择",
    },
    {
      id: 2,
      title: "小说导入",
      description: "导入 TXT/Markdown 小说，按章节拆分，保留原文。",
      targetTab: "studio",
      actionLabel: "去导入",
    },
    {
      id: 3,
      title: "事件分析",
      description: "逐章结构化提取「发生了什么」+主线关系/信息密度/预估集长/情绪，作为分集取舍依据。",
      targetTab: "studio",
      actionLabel: "去分析",
    },
    {
      id: 4,
      title: "剧本策划",
      description: "故事骨架（三幕/分集/付费）→改编策略→（可选细纲）→剧本草稿，输出统一剧本格式。短篇可直接改写成剧本。",
      targetTab: "studio",
      actionLabel: "去策划",
    },
    {
      id: 5,
      title: "实体提取",
      description: "从剧本提取角色/场景/道具并去重、按集关联，建立全程引用的实体库（一致性骨架）。",
      targetTab: "assets",
      actionLabel: "去资产",
    },
    {
      id: 6,
      title: "分镜拆解",
      description: "把每场拆成镜头：景别/运镜/时长/画面描述/3 秒分段视频提示词，绑定 scene_id 与 character_ids。",
      targetTab: "studio",
      actionLabel: "去分镜",
    },
    {
      id: 7,
      title: "一致性资产",
      description: "为角色/场景定版（宫格图/参考图），配合剧集圣经全局注入，保证跨镜头跨集一致。",
      targetTab: "assets",
      actionLabel: "去资产",
    },
    {
      id: 8,
      title: "音色分配",
      description: "按性别/年龄/性格为角色分配音色，结合本地 TTS 声音克隆生成配音。",
      targetTab: "tts",
      actionLabel: "去配音",
    },
    {
      id: 9,
      title: "生图与生视频",
      description: "每个分镜先出首/尾帧图，再图生视频，生成各镜头片段。",
      targetTab: "studio",
      actionLabel: "去生成",
    },
    {
      id: 10,
      title: "剪辑成片",
      description: "拼接已选片段，处理字幕、配音与 BGM，本地 FFmpeg 合成输出 episode 成片。",
      targetTab: "export",
      actionLabel: "去导出",
    },
  ] satisfies OverviewWorkflowStep[],
};
