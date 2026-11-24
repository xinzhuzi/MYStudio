// 1121 修复钉(生产路径载荷):StudioView 两挂载点恒传 productionFlowNodes
// (index.tsx 两处 ComfyCanvasSwap),活路径永远走 mapProductionFlowNodes-
// ToStagePayloads——e74b78a5 迁移的分镜批量动作只写进回落构建器,生产载荷
// storyboard/actions=[](节点模型空)、workbench 无 actions、remotion=老画布
// 派发 kind enqueue-remotion-shots(桥 ALLOWED_KINDS 与宿主 handlers 均无
// 消费方),面板退役后六钮+H3 全家+重建轨道=功能断链;逐镜 shots 丢 id→
// 单镜 H3 直达钮(引擎 shot-production 读 shot.id)恒不渲染。
import { describe, expect, it } from "vitest";
import { mapProductionFlowNodesToStagePayloads } from "./stage-payload-map";
import type {
  ProductionFlowNodeModel,
  ProductionFlowRemotionShot,
} from "../../studio/workflow-node-model-schema";

function node(id: string, extra: Partial<ProductionFlowNodeModel> = {}): ProductionFlowNodeModel {
  return {
    id: id as ProductionFlowNodeModel["id"],
    label: id,
    description: "",
    status: "empty",
    metrics: [],
    previewTitle: "",
    previewLines: [],
    targetStage: "storyboard",
    ...extra,
  };
}

function shot(partial: Partial<ProductionFlowRemotionShot> & { shotId: string; index: number }): ProductionFlowRemotionShot {
  return { title: "", status: "pending", progress: 0, ...partial };
}

/** 照生产节点模型实况(workflow-node-model-node-builders):storyboard
 * actions=[]、remotionProduction=enqueue-remotion-shots、workbench 无 actions。 */
const sevenNodes = (): ProductionFlowNodeModel[] => [
  node("script"),
  node("scriptPlan", {
    actions: [{ id: "generate-director-plan", label: "生成导演规划", targetStage: "storyboard", paid: true }],
  }),
  node("assets"),
  node("storyboardTable", {
    actions: [{ id: "generate-storyboard-table", label: "生成分镜表", targetStage: "storyboard", paid: true }],
  }),
  node("storyboard", {
    storyboardTiles: [{ id: "sb-1", index: 1, title: "S01", state: "ready" }],
    actions: [],
  }),
  node("remotionProduction", {
    remotionShots: [shot({ shotId: "sb-1", index: 1, title: "雨夜石桥" })],
    actions: [{ id: "enqueue-remotion-shots", label: "一键生成所有视频", targetStage: "workbench" }],
  }),
  node("workbench"),
];

describe("mapProductionFlowNodesToStagePayloads(1121 修复:生产路径动作族+逐镜 id)", () => {
  it("三型节点动作族与回落构建器同源:storyboard 六钮/H3 全家/重建轨道不再缺席", () => {
    const byKey = new Map(mapProductionFlowNodesToStagePayloads(sevenNodes()).map((p) => [p.key, p]));
    const storyboard = byKey.get("storyboard")!;
    expect(storyboard.actions!.map((a) => a.kind)).toEqual([
      "generate-images", "generate-images-force", "generate-images-stop",
      "auto-bind-assets", "chapter-pipeline-start", "daoyan-import",
    ]);
    expect(storyboard.actions!.find((a) => a.kind === "generate-images-force")!.paid).toBe(true);
    const remotion = byKey.get("remotionProduction")!;
    expect(remotion.actions!.map((a) => a.kind)).toEqual([
      "generate-videos", "h3-start", "h3-start", "h3-stop",
      "h3-import-orphans", "h3-archive-backfill", "open-final-video",
    ]);
    expect(remotion.actions!.filter((a) => a.kind === "h3-start").map((a) => a.noteKey))
      .toEqual(["480p", "960p"]);
    expect(byKey.get("workbench")!.actions!.map((a) => a.kind)).toEqual(["rebuild-workbench-tracks"]);
  });

  it("bug2:老画布派发 kind enqueue-remotion-shots 不透传,同义钮=桥 kind generate-videos", () => {
    const remotion = mapProductionFlowNodesToStagePayloads(sevenNodes())
      .find((p) => p.key === "remotionProduction")!;
    expect(remotion.actions!.some((a) => a.kind === "enqueue-remotion-shots")).toBe(false);
    expect(remotion.actions![0]).toMatchObject({ kind: "generate-videos", label: "一键生成所有视频" });
  });

  it("bug4:逐镜载荷带 id(remotionShots[].shotId → shots[].id),单镜 H3 直达钮可达", () => {
    const remotion = mapProductionFlowNodesToStagePayloads(sevenNodes())
      .find((p) => p.key === "remotionProduction")!;
    expect(remotion.shots![0].id).toBe("sb-1");
  });

  it("bug5:分镜磁贴载荷带 id(storyboardTiles[].id → tiles[].id),磁贴行点击可达", () => {
    const storyboard = mapProductionFlowNodesToStagePayloads(sevenNodes())
      .find((p) => p.key === "storyboard")!;
    expect(storyboard.tiles![0].id).toBe("sb-1");
  });

  it("动作禁用语义随数据:零分镜禁生成类/全就绪禁再生成,停止类常驻", () => {
    const empty = mapProductionFlowNodesToStagePayloads([
      node("storyboard", { storyboardTiles: [] }),
      node("remotionProduction", { remotionShots: [] }),
    ]);
    const storyboard = empty.find((p) => p.key === "storyboard")!.actions!;
    expect(storyboard.find((a) => a.kind === "generate-images")!.disabled).toBe(true);
    expect(storyboard.find((a) => a.kind === "generate-images-force")!.disabled).toBe(true);
    expect(storyboard.find((a) => a.kind === "generate-images-stop")!.disabled).toBeUndefined();
    const remotion = empty.find((p) => p.key === "remotionProduction")!.actions!;
    expect(remotion.filter((a) => a.kind === "h3-start").every((a) => a.disabled === true)).toBe(true);

    const done = mapProductionFlowNodesToStagePayloads([
      node("remotionProduction", {
        remotionShots: [
          shot({ shotId: "sb-1", index: 1, status: "succeeded", outputPath: "/out/1.mp4" }),
          shot({ shotId: "sb-2", index: 2, status: "succeeded", outputPath: "/out/2.mp4" }),
        ],
      }),
    ]).find((p) => p.key === "remotionProduction")!.actions!;
    expect(done[0]).toMatchObject({ kind: "generate-videos", label: "分镜视频已完成", disabled: true });
  });

  it("透传型不回归:scriptPlan/storyboardTable 照节点模型透传,assets=抽取首位+透传合并,script 无动作", () => {
    const byKey = new Map(mapProductionFlowNodesToStagePayloads([
      ...sevenNodes().slice(0, 4),
      node("assets", {
        assetGroups: [],
        actions: [{ id: "generate-director-plan", label: "外挂动作", targetStage: "storyboard" }],
      }),
    ]).map((p) => [p.key, p]));
    expect(byKey.get("scriptPlan")!.actions)
      .toEqual([{ kind: "generate-director-plan", label: "生成导演规划", paid: true }]);
    expect(byKey.get("storyboardTable")!.actions!.map((a) => a.kind)).toEqual(["generate-storyboard-table"]);
    expect(byKey.get("script")!.actions).toBeUndefined();
    const assets = byKey.get("assets")!.actions!;
    expect(assets.map((a) => a.kind)).toEqual(["extract-assets", "generate-director-plan"]);
    expect(assets[0].label).toBe("抽取资产"); // assetGroups 空=首抽文案
  });
});
