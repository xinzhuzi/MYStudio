import { describe, expect, it } from "vitest";
import type { StudioFlowAssetItem } from "@/lib/studio/studio-flow-data";
import type { ScriptPlan } from "@/types/studio";
import { buildAssetDerivationModel } from "./workflow-asset-derivation-model";
import { scriptPlanSourceFingerprint } from "./workflow-helpers";

const assets: StudioFlowAssetItem[] = [
  { id: "char-1", name: "独孤剑尘", type: "character", episodeId: "chapter-001" },
];

function planWithFingerprint(scriptFingerprint?: string): ScriptPlan {
  return {
    id: "plan-1",
    episodeId: "chapter-001",
    theme: "",
    visualStyle: "",
    narrativeRhythm: "",
    sceneIntents: [],
    soundDirection: "",
    transitions: "",
    ...(scriptFingerprint === undefined ? {} : { scriptFingerprint }),
    derivedAssetPlan: [
      { parentAssetId: "char-1", state: "雨夜湿衣", reason: "夜访道口镇多镜复用" },
    ],
  };
}

const currentScript = "第一场金水河码头，独孤剑尘救下小杂役。";
const currentFingerprint = scriptPlanSourceFingerprint("chapter-001", currentScript);

describe("buildAssetDerivationModel planStale(二期 R1 预划剧本锚比对)", () => {
  it("剧本未变(指纹一致)→ 不报过期", () => {
    const { summary } = buildAssetDerivationModel(
      assets,
      [planWithFingerprint(currentFingerprint)],
      {},
      { currentScriptFingerprint: currentFingerprint },
    );
    expect(summary.planned).toBe(1);
    expect(summary.planStale).toBeFalsy();
  });

  it("剧本改词(指纹漂移)→ 报过期;重跑后新指纹匹配 → 提示消失", () => {
    const stale = buildAssetDerivationModel(
      assets,
      [planWithFingerprint(scriptPlanSourceFingerprint("chapter-001", "旧版剧本正文"))],
      {},
      { currentScriptFingerprint: currentFingerprint },
    );
    expect(stale.summary.planStale).toBe(true);

    // 重跑导演规划:落库新指纹 = 当前剧本指纹 → 提示自然消失
    const rerun = buildAssetDerivationModel(
      assets,
      [planWithFingerprint(currentFingerprint)],
      {},
      { currentScriptFingerprint: currentFingerprint },
    );
    expect(rerun.summary.planStale).toBeFalsy();
  });

  it("存量 plan 无指纹 → 静默不比对(即使当前指纹已传)", () => {
    const { summary } = buildAssetDerivationModel(
      assets,
      [planWithFingerprint()],
      {},
      { currentScriptFingerprint: currentFingerprint },
    );
    expect(summary.planStale).toBeFalsy();
  });

  it("比对侧未传当前指纹 → 静默(旧调用方兼容)", () => {
    const { summary } = buildAssetDerivationModel(
      assets,
      [planWithFingerprint("whatever-fp")],
      {},
    );
    expect(summary.planStale).toBeFalsy();
  });

  // D2(10-13-audit4-downstream,裁定④⑤)GREEN:本用例原锁「planned=0 即使指纹
  // 漂移也不报」——那正是被拆掉的 planned>0 前置(design §3:过期判定只看指纹,
  // 不随派生资产匹配数浮动)。按新语义改写(设计变更,非断言弱化;RED 轮
  // workflow-asset-derivation-model.test.ts 曾以新断言先红,本用例即其收编)。
  it("D2: 空 ⑦ 清单(planned=0)指纹漂移 → 仍报过期(过期判定只看指纹,不随 planned 浮动)", () => {
    const emptyPlan: ScriptPlan = {
      ...planWithFingerprint("old-fp"),
      derivedAssetPlan: [],
    };
    const { summary } = buildAssetDerivationModel(
      assets,
      [emptyPlan],
      {},
      { currentScriptFingerprint: currentFingerprint },
    );
    expect(summary.planned).toBe(0);
    expect(summary.planStale).toBe(true);
  });

  it("换章指纹不同章 → 以传入的当前章指纹为准比对", () => {
    const otherChapterFingerprint = scriptPlanSourceFingerprint("chapter-002", currentScript);
    const { summary } = buildAssetDerivationModel(
      assets,
      [planWithFingerprint(otherChapterFingerprint)],
      {},
      { currentScriptFingerprint: currentFingerprint },
    );
    expect(summary.planStale).toBe(true);
  });
});
