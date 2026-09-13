"use client";
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 画布槽位(09-09 换代批6 终态):ComfyUI 画布 + 旧画布退役占位。
 * 旧 React Flow 画布已退役删除;存量数据冻结在 store(深链照常读写),
 * 画布化操作全走 ComfyUI。
 *
 * 09-10 用户裁定(三轮):「导入存量画布」入口与退役说明文案全撤。
 * 09-11 用户裁定(沉浸延伸):工作流画布阶段与本地模型模块同享沉浸布局,
 * 状态与切换入口已全部归悬浮球——头部标题条(含分镜画布返回)整块退役,
 * 画布即全部;离开画布=悬浮球面板阶段直达。
 */

import { ComfyCanvasStudio } from "./ComfyCanvasStudio";

export function ComfyCanvasSwap({
  autoOpenOverview = false,
  manyingScope,
  sidebarActions,
  stageFlowNodes,
}: {
  /** 工作流阶段(分镜制作)专用:进入即自动打开本章分镜总览 */
  autoOpenOverview?: boolean;
  /** 模块分野(09-11 裁定):workflow=漫影侧栏默认「分镜」页签;models=默认「工作流」页签 */
  manyingScope?: "workflow" | "models";
  /** 老画布节点模型(09-12 v4 内容全量:技能/资产卡/队列进度经此喂入节点载荷) */
  stageFlowNodes?: import("../../studio/workflow-node-model-schema").ProductionFlowNodeModel[];
  /** 制作动作宿主侧(09-11):侧栏按钮→宿主批量钩子 */
  sidebarActions?: {
    onGenerateImages: () => void;
    onGenerateVideos: () => void;
    /** 09-12 功能完备:老画布环节动作回流(付费 LLM 生成,经 handleProductionNodeAction) */
    onGenerateDirectorPlan?: () => void;
    onGenerateStoryboardTable?: () => void;
    onRebuildWorkbenchTracks?: () => void;
    /** 09-13:节点「全文/编辑」回流(note=环节 key) */
    onViewNodeDoc?: (stageKey: string) => void;
    onEditNodeDoc?: (stageKey: string) => void;
    /** 09-13:衍生资产节点「抽取资产」回流 */
    onExtractAssets?: () => void;
  };
} = {}) {
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col" data-comfy-swap="comfy">
      <ComfyCanvasStudio autoOpenOverview={autoOpenOverview} manyingScope={manyingScope} sidebarActions={sidebarActions} stageFlowNodes={stageFlowNodes} />
    </div>
  );
}
