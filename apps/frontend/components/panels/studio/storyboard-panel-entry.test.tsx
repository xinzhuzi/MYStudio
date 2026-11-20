// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 分镜面板入口·退役契约(1120 分镜面板退役,S9 摘壳)。
 *
 * 原浮钮(storyboard-panel-entry.tsx)与面板页(storyboardPanel TabsContent)
 * 已整删:批量/单镜功能全量迁引擎节点动作(storyboard-pipeline-comfy 载荷
 * +桥 generate-images-force/h3-start/open-shot-image 等 kind+宿主
 * sidebarActions)。本件钉退役事实,防回潮:
 * - index.tsx 源码不含浮钮锚 data-storyboard-panel-entry 与浮钮组件;
 * - storyboard 节点动作 generate-images 仍是批量生图入口(载荷真源在案);
 * - 页签数组不含 storyboardPanel;存量落盘值经别名回落分镜画布。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORKFLOW_TABS, resolveVisibleWorkflowStage } from "./workflow-stage/workflow-tabs";

const INDEX_SOURCE = readFileSync(
  resolve(process.cwd(), "frontend/components/panels/studio/index.tsx"),
  "utf8",
);
const PIPELINE_SOURCE = readFileSync(
  resolve(process.cwd(), "frontend/lib/assist/image-studio/storyboard-pipeline-comfy.ts"),
  "utf8",
);

describe("分镜面板入口退役契约(1120 S9 摘壳)", () => {
  it("浮钮退役:index.tsx 无浮钮组件/锚/挂点,面板页签无 TabsContent", () => {
    expect(INDEX_SOURCE).not.toContain("StoryboardPanelEntryButton");
    expect(INDEX_SOURCE).not.toContain('data-storyboard-panel-entry');
    expect(INDEX_SOURCE).not.toContain('value="storyboardPanel"');
  });

  it("storyboard 节点 generate-images 为批量生图唯一生图入口(载荷在案)", () => {
    // 载荷真源:一键生图(常规)+force(全量重出)双双在场——引擎节点按钮承载
    expect(PIPELINE_SOURCE).toContain('kind: "generate-images", label: "一键生图"');
    expect(PIPELINE_SOURCE).toContain('kind: "generate-images-force"');
  });

  it("页签数组无 storyboardPanel;存量落盘值别名回落分镜画布", () => {
    expect(WORKFLOW_TABS.map((tab) => tab.value)).not.toContain("storyboardPanel");
    expect(resolveVisibleWorkflowStage("storyboardPanel")).toBe("storyboard");
  });

  it("四个桥宿主 hook 仍挂 StudioView(摘壳不误删桥执行链)", () => {
    expect(INDEX_SOURCE).toContain("useStoryboardBatchGeneration({");
    expect(INDEX_SOURCE).toContain("useStoryboardH3VideoBatch({");
    expect(INDEX_SOURCE).toContain("useStoryboardAssetBinding(");
    expect(INDEX_SOURCE).toContain("useChapterPipelineOrchestrator({");
  });
});
