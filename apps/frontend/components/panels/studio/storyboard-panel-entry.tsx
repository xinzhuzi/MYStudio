"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 分镜面板独立入口(1115 第一章实弹 FR4 发车口补·二裁路 2)。
 *
 * 缘起:D3 详情浮层役把引擎侧五型 view-doc 改为引擎本地浮层后,storyboardPanel
 * (分镜详情页:一键生图/断点续跑/H3 出片/章验收卡)的原唯一入口(引擎节点
 * 「详情」过桥跳 App 阶段页)退役,面板成孤岛——集成回归,实弹实证(桥注入
 * view-doc 恒不消费)。本件=App 侧最小独立入口按钮,禁重接 view-doc 桥
 * (二裁:该桥已证脆弱,详情本地化是用户令,不回耦)。
 *
 * 挂点:studio 工作流视图左下角浮钮;已在分镜面板页时隐藏。
 */
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StoryboardPanelEntryButton({
  onOpen,
  hidden,
}: {
  onOpen: () => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="fixed bottom-4 left-4 z-40">
      <Button
        size="sm"
        variant="outline"
        data-storyboard-panel-entry
        title="打开分镜面板(一键生图/H3 出片/章验收)"
        onClick={onOpen}
      >
        <LayoutTemplate className="h-3.5 w-3.5" />
        分镜面板
      </Button>
    </div>
  );
}
