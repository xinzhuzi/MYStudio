// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 章验收横幅·画布新宿主挂点契约(1120 分镜面板退役迁引擎,S6)。
 *
 * 挂点=StudioView storyboard 画布 TabsContent(面板退役后横幅唯一宿主):
 * - 组件行为断言:actionable 卡横幅在场+三回路(重跑流水线/去资产页/分镜表
 *   再生成)可点——组件复用不重写,行为面在组件层既有;此处钉「新宿主接线」;
 * - 源码串断言(workflow-tabs.test.ts 同款范式):横幅挂 storyboard 页内、
 *   goToAssets 回路=handleStageChange("assets")、regenerate 回路=
 *   handleProductionNodeAction(generate-storyboard-table)、断点续跑
 *   hook(useChapterPipelineOrchestrator)仍在 StudioView 防误删。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_SOURCE = readFileSync(
  resolve(process.cwd(), "frontend/components/panels/studio/index.tsx"),
  "utf8",
);

describe("章验收横幅·画布新宿主(S6,1120 面板退役)", () => {
  it("横幅挂 storyboard 画布 TabsContent 内(画布页在场渲染,非面板页)", () => {
    // 挂点锚:storyboard TabsContent 与横幅组件同时在场
    expect(INDEX_SOURCE).toContain('<TabsContent\n              value="storyboard"');
    expect(INDEX_SOURCE).toContain("<ChapterAcceptanceBanner");
    // 横幅位于画布 TabsContent 块内(value="storyboard" 先于组件出现)
    const tabsAt = INDEX_SOURCE.indexOf('value="storyboard"');
    const bannerAt = INDEX_SOURCE.indexOf("<ChapterAcceptanceBanner");
    expect(tabsAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeGreaterThan(tabsAt);
    // ComfyCanvasSwap 仍在画布页(横幅是画布附加行,不取代画布)
    expect(INDEX_SOURCE).toContain('<ComfyCanvasSwap autoOpenOverview myScope="workflow"');
  });

  it("props 接线照搬面板原链:pipeline.start/stale 计数/goToAssets/regenerate", () => {
    expect(INDEX_SOURCE).toContain("run={chapterPipeline.run}");
    expect(INDEX_SOURCE).toContain("staleCount={chapterPipeline.staleTasks.length}");
    expect(INDEX_SOURCE).toContain("staleSourceScriptCount={chapterPipeline.staleSourceScriptCount}");
    expect(INDEX_SOURCE).toContain("onRunPipeline={chapterPipeline.start}");
  });

  it("goToAssets 回路=handleStageChange(\"assets\")(剧本资产管理页)", () => {
    expect(INDEX_SOURCE).toContain('onGoToAssets={() => viewModel.handleStageChange("assets")}');
  });

  it("regenerate 回路走 handleProductionNodeAction(generate-storyboard-table,D-5 修复回路)", () => {
    expect(INDEX_SOURCE).toContain("onRegenerateStoryboardTable={() => {");
    // 分镜表再生成=handleProductionNodeAction(id 同桥 generate-storyboard-table 同链)
    expect(INDEX_SOURCE).toContain('id: "generate-storyboard-table"');
    expect(INDEX_SOURCE).toMatch(/onRegenerateStoryboardTable[\s\S]{0,200}id: "generate-storyboard-table"/);
    // 桥侧同名动作入口仍在(引擎节点按钮→sidebarActions 同链)
    expect(INDEX_SOURCE).toContain("onGenerateStoryboardTable:");
  });

  it("断点续跑 hook 挂载不动:useChapterPipelineOrchestrator 仍在 StudioView", () => {
    expect(INDEX_SOURCE).toContain("useChapterPipelineOrchestrator({");
  });

  it("1125 孤儿浮条根修:引擎不可达(画布 running=false)时横幅不渲染", () => {
    // 挂载点条件渲染:canvasRunning=false=画布「远端引擎未就绪」空态在屏——
    // 横幅此时无上下文,隐藏;null(未探明)/true 照常渲染
    expect(INDEX_SOURCE).toContain("{canvasRunning !== false ? (");
    // 就绪态信号链:Swap 上抛 running → StudioView setState → 同源判据
    expect(INDEX_SOURCE).toContain("const [canvasRunning, setCanvasRunning] = useState<boolean | null>(null);");
    expect(INDEX_SOURCE).toContain('onCanvasRunningChange={setCanvasRunning}');
  });
});
