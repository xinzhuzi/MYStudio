import { describe, expect, it } from "vitest";
import {
  syncDerivedAssets,
  type DerivedCharacterSink,
  type DerivedPropSink,
  type DerivedSceneSink,
  type EntityResolver,
} from "./derived-asset-sync";
import type { ScriptPlan } from "@/types/studio";

function makeSinks() {
  const calls = {
    addVariation: [] as Array<{ characterId: string; variation: any }>,
    addScene: [] as any[],
    addProp: [] as any[],
  };
  let varSeq = 0;
  let sceneSeq = 0;
  let propSeq = 0;

  const characterSink: DerivedCharacterSink = {
    addVariation: (characterId, variation) => {
      calls.addVariation.push({ characterId, variation });
      return `var_${++varSeq}`;
    },
  };
  const sceneSink: DerivedSceneSink = {
    addScene: (input) => {
      calls.addScene.push(input);
      return `scene_${++sceneSeq}`;
    },
  };
  const propSink: DerivedPropSink = {
    addProp: (input) => {
      calls.addProp.push(input);
      return `prop_${++propSeq}`;
    },
  };
  return { characterSink, sceneSink, propSink, calls };
}

// 角色 林逸 → char-001（已存在）；场景 客栈大堂 → scene-001（已存在）；道具 青铜灯 → prop-001（已存在）；未知资产 → null
const resolver: EntityResolver = (name) => {
  const map: Record<string, { kind: "character" | "scene" | "prop"; id: string }> = {
    林逸: { kind: "character", id: "char-001" },
    客栈大堂: { kind: "scene", id: "scene-001" },
    青铜灯: { kind: "prop", id: "prop-001" },
  };
  return map[name] ?? null;
};

describe("studio derived asset sync", () => {
  it("routes character variations to addVariation, scene angle/state variants to addScene, skips unresolved parents", () => {
    const plan: ScriptPlan = {
      id: "p1",
      episodeId: "ep1",
      theme: "",
      visualStyle: "",
      narrativeRhythm: "",
      sceneIntents: [],
      soundDirection: "",
      transitions: "",
      derivedAssetPlan: [
        { parentAssetId: "林逸", state: "受伤带血", reason: "第3段决斗后多镜复用" },
        { parentAssetId: "客栈大堂", state: "夜景版", reason: "Sc7 夜戏定场" },
        { parentAssetId: "客栈大堂", state: "背面视角", reason: "Sc7 正反打" },
        { parentAssetId: "青铜灯", state: "破损版", reason: "Sc8 近景道具" },
        { parentAssetId: "幽灵资产", state: "破损版", reason: "未匹配父资产" },
      ],
    };

    const { characterSink, sceneSink, propSink, calls } = makeSinks();
    const { created, summary } = syncDerivedAssets(plan.derivedAssetPlan, {
      projectId: "proj-1",
      resolver,
      characterSink,
      sceneSink,
      propSink,
    });

    // character variation
    expect(calls.addVariation).toHaveLength(1);
    expect(calls.addVariation[0]?.characterId).toBe("char-001");
    expect(calls.addVariation[0]?.variation.name).toBe("受伤带血");
    expect(calls.addVariation[0]?.variation.visualPrompt).toContain("受伤带血");

    // scene variants: both 夜景版 (state) and 背面视角 (angle) → addScene
    expect(calls.addScene).toHaveLength(2);
    const nightScene = calls.addScene.find((s) => s.name.includes("夜景版"));
    expect(nightScene?.parentSceneId).toBe("scene-001");
    expect(nightScene?.isViewpointVariant).toBe(true);
    expect(nightScene?.projectId).toBe("proj-1");

    // tool/prop variants must not be skipped; Toonflow derive assets include type=tool.
    expect(calls.addProp).toHaveLength(1);
    expect(calls.addProp[0]).toMatchObject({
      name: "青铜灯·破损版",
      projectId: "proj-1",
      parentId: "prop-001",
      isDerivative: true,
      description: "Sc8 近景道具",
      category: "破损版",
    });

    // created records map to real new ids
    expect(created).toHaveLength(4);
    expect(created.map((c) => c.parentAssetId)).toEqual(["char-001", "scene-001", "scene-001", "prop-001"]);

    // counts
    expect(summary.created).toBe(4);
    expect(summary.skipped).toBe(1);
  });
});
