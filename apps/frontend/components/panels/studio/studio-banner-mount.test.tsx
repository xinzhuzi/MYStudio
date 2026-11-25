// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 章验收横幅·画布页宿主摘除契约(1126 用户裁定:画布页顶横幅整体摘除)。
 *
 * 沿革:11-20 从旧面板迁到 storyboard 画布 TabsContent;11-25 摆位修
 * (mt-8 mx-3 让位交通灯+引擎不可达不渲染);11-26 用户实弹驳回——「这不是
 * 还有横幅吗?」,要的是它不在那儿,不是挪位置 → 挂载整体摘除,状态与待办
 * 入口归任务中心悬浮球(OrbTasksSection)。组件本体保留未删。
 *
 * 本文件钉「摘除」契约(源码串断言,workflow-tabs.test.ts 同款范式):
 * - index.tsx 不再 import/挂载 ChapterAcceptanceBanner,不再有 canvasRunning 态;
 * - 画布(ComfyCanvasSwap)与断点续跑 hook(useChapterPipelineOrchestrator)
 *   仍在 StudioView,防摘横幅时误删生产链;
 * - 组件文件仍在(仅摘挂载,不是删组件)。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_SOURCE = readFileSync(
  resolve(process.cwd(), "frontend/components/panels/studio/index.tsx"),
  "utf8",
);

describe("章验收横幅·画布页宿主摘除(1126 用户裁定)", () => {
  it("index.tsx 不再 import 也不再挂载 ChapterAcceptanceBanner", () => {
    // 注释里允许提到组件名(说明摘除来龙去脉),钉的是「无 import、无 JSX 挂载」
    expect(INDEX_SOURCE).not.toContain('import { ChapterAcceptanceBanner }');
    expect(INDEX_SOURCE).not.toMatch(/<ChapterAcceptanceBanner[\s>]/);
  });

  it("不再有 canvasRunning 态与 onCanvasRunningChange 接线(随横幅一并退役)", () => {
    expect(INDEX_SOURCE).not.toContain("canvasRunning");
    expect(INDEX_SOURCE).not.toContain("onCanvasRunningChange");
  });

  it("画布仍在 storyboard 页(摘横幅不动画布)", () => {
    expect(INDEX_SOURCE).toContain('<TabsContent\n              value="storyboard"');
    expect(INDEX_SOURCE).toContain('<ComfyCanvasSwap autoOpenOverview myScope="workflow"');
  });

  it("断点续跑 hook 挂载不动:useChapterPipelineOrchestrator 仍在 StudioView", () => {
    expect(INDEX_SOURCE).toContain("useChapterPipelineOrchestrator({");
    // 侧栏「重跑章流水线」动作入口仍在(pipeline.start 消费点)
    expect(INDEX_SOURCE).toContain("chapterPipeline.start()");
  });

  it("组件本体保留(仅摘挂载,不是删组件)", () => {
    expect(
      existsSync(
        resolve(process.cwd(), "frontend/components/panels/studio/ChapterAcceptanceBanner.tsx"),
      ),
    ).toBe(true);
  });
});
