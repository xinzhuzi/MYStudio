// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssetDerivationPreview } from "./asset-derivation-preview";
import type { ProductionFlowNodeModel } from "../workflow-node-model";

afterEach(cleanup);

function buildNodeWithDerivedCount(count: number): ProductionFlowNodeModel {
  return {
    id: "assets",
    label: "衍生资产",
    description: "",
    status: "ready",
    metrics: [],
    previewTitle: "剧本资产",
    previewLines: [],
    previewKind: "asset-derivation",
    targetStage: "assets",
    assetSummary: {
      planned: count,
      existing: count,
      linked: count,
      completed: count,
      missingParent: 0,
      unused: 0,
      unplanned: 0,
    },
    assetGroups: [
      {
        source: {
          id: "char-1",
          name: "独孤剑尘",
          typeLabel: "角色",
          runtimeType: "role",
          mediaPath: "project-file://daojie/assets/char-1.png",
          isDerived: false,
        },
        derived: Array.from({ length: count }, (_, index) => ({
          id: `char-1:state-${index + 1}`,
          name: `状态${index + 1}`,
          typeLabel: "角色",
          runtimeType: "role" as const,
          mediaPath: `project-file://daojie/assets/char-1-${index + 1}.png`,
          state: `状态${index + 1}`,
          parentAssetId: "char-1",
          generationState: "已完成" as const,
          isDerived: true,
        })),
      },
    ],
  };
}

describe("AssetDerivationPreview(R0 去截断)", () => {
  it(">4 个衍生资产时全量渲染,不 slice(0,4)", () => {
    const node = buildNodeWithDerivedCount(6);
    const { container } = render(<AssetDerivationPreview node={node} />);
    const derivedCards = container.querySelectorAll(
      '[data-asset-generation-state="已完成"]',
    );
    expect(derivedCards).toHaveLength(7); // 6 衍生 + 1 父资产原卡
    expect(screen.getByText("状态5")).toBeTruthy();
    expect(screen.getByText("状态6")).toBeTruthy();
  });

  it("渲染 summary 四格与类型过滤开关", () => {
    const node = buildNodeWithDerivedCount(2);
    render(<AssetDerivationPreview node={node} />);
    expect(screen.getByText("导演预划")).toBeTruthy();
    expect(screen.getByText("已有衍生")).toBeTruthy();
    expect(screen.getByText("已完成图片")).toBeTruthy();
    expect(screen.getByText("缺父资产")).toBeTruthy();
    expect(screen.getByRole("button", { name: /全部 1/ })).toBeTruthy();
  });

  it("stale 衍生卡渲染「过期」徽章与人话 tooltip;无锚卡静默", () => {
    const node = buildNodeWithDerivedCount(2);
    const derivedCards = node.assetGroups?.[0]?.derived;
    expect(derivedCards).toBeDefined();
    if (!derivedCards) return;
    derivedCards[1]!.stale = true;
    const { container } = render(<AssetDerivationPreview node={node} />);
    const staleBadges = container.querySelectorAll('[data-asset-stale="true"]');
    expect(staleBadges).toHaveLength(1);
    expect(staleBadges[0]?.textContent).toBe("过期");
    expect(staleBadges[0]?.getAttribute("title")).toBe(
      "父资产图已更新，这张衍生图是按旧版生成的",
    );
  });

  it("unused 衍生卡渲染「未使用」徽章;组行渲染「分镜用到·未预划」提示", () => {
    const node = buildNodeWithDerivedCount(2);
    const derivedCards = node.assetGroups?.[0]?.derived;
    if (!derivedCards) throw new Error("fixture missing derived cards");
    derivedCards[1]!.unused = true;
    node.assetGroups![0]!.unplanned = [
      { state: "染血版", evidenceShotIds: ["shot-1", "shot-2"] },
    ];
    const { container } = render(<AssetDerivationPreview node={node} />);
    const unusedBadges = container.querySelectorAll('[data-asset-unused="true"]');
    expect(unusedBadges).toHaveLength(1);
    expect(unusedBadges[0]?.textContent).toBe("未使用");
    expect(unusedBadges[0]?.getAttribute("title")).toBe(
      "导演预划了这个衍生状态，但当前章的分镜一次都没用到它",
    );
    expect(screen.getByText("分镜用到·未预划")).toBeTruthy();
    expect(screen.getByText("染血版 · 2 镜")).toBeTruthy();
    const hint = container.querySelector(".asset-derive-unplanned");
    expect(hint?.getAttribute("title")).toBe(
      "分镜里实际用到了这些状态，但导演规划时没有预划它们。需要的话重跑一次导演规划。",
    );
  });

  it("planStale 时 summary 下渲染「预划已过期」提示行与人话 tooltip;未过期静默", () => {
    const staleNode = buildNodeWithDerivedCount(2);
    staleNode.assetSummary!.planStale = true;
    const { container: staleContainer } = render(<AssetDerivationPreview node={staleNode} />);
    expect(screen.getByText("预划已过期·建议重跑导演规划")).toBeTruthy();
    const hint = staleContainer.querySelector(".asset-derive-plan-stale");
    expect(hint?.getAttribute("title")).toBe(
      "剧本改过了，这份清单是按旧剧本规划的，重跑导演规划可更新。",
    );

    cleanup();
    const freshNode = buildNodeWithDerivedCount(2);
    const { container: freshContainer } = render(<AssetDerivationPreview node={freshNode} />);
    expect(freshContainer.querySelector(".asset-derive-plan-stale")).toBeNull();
  });
});
