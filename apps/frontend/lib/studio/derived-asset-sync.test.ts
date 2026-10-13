import { describe, expect, it } from "vitest";
import {
  buildEntityResolver,
  syncDerivedAssets,
  type DerivedCharacterSink,
  type DerivedPropSink,
  type DerivedSceneSink,
  type EntityResolver,
} from "./derived-asset-sync";
import type { ScriptPlan } from "@/types/studio";

function makeSinks() {
  const calls = {
    addVariation: [] as Array<{
      characterId: string;
      variation: Parameters<DerivedCharacterSink["addVariation"]>[1];
    }>,
    addScene: [] as Array<Parameters<DerivedSceneSink["addScene"]>[0]>,
    addProp: [] as Array<Parameters<DerivedPropSink["addProp"]>[0]>,
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
  const map: Record<string, { kind: "character" | "scene" | "prop"; id: string; name: string }> = {
    林逸: { kind: "character", id: "char-001", name: "林逸" },
    客栈大堂: { kind: "scene", id: "scene-001", name: "客栈大堂" },
    青铜灯: { kind: "prop", id: "prop-001", name: "青铜灯" },
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

describe("1013 修 RC-7:「名·状态」复合名降级匹配 + 规范名行名组装", () => {
  // 模拟手术后批次行(批次行名口径):角色 独孤剑尘 / 场景 金水塾馆 / 道具 青盐鞭
  const compositeResolver = buildEntityResolver(
    [{ id: "char-dugu", name: "独孤剑尘", aliases: [] }],
    [{ id: "scene-shuguan", name: "金水塾馆" }],
    [{ id: "prop-qingyanbian", name: "青盐鞭" }],
  );

  it("整名精确命中优先;「名·状态」复合名取首个「·」前段降级命中", () => {
    expect(compositeResolver("独孤剑尘")).toEqual({
      kind: "character",
      id: "char-dugu",
      name: "独孤剑尘",
    });
    expect(compositeResolver("独孤剑尘·灰衫逃亡状态")).toEqual({
      kind: "character",
      id: "char-dugu",
      name: "独孤剑尘",
    });
  });

  it("前段不等于任何键时不降级命中(防误匹配)", () => {
    // 旧背囊无实体;灰白碎灵石·测灵状态 的前段「灰白碎灵石」≠「碎灵石」不中
    expect(compositeResolver("旧背囊·断剑沉寂状态")).toBeNull();
    expect(compositeResolver("灰白碎灵石·测灵状态")).toBeNull();
  });

  it("1013 裁定补:尾部全/半角括注剥除后精确命中(碎灵石(基础道具)→碎灵石)", () => {
    const parenResolver = buildEntityResolver(
      [],
      [],
      [{ id: "prop-sls", name: "碎灵石" }],
    );
    expect(parenResolver("碎灵石（基础道具）")).toEqual({
      kind: "prop",
      id: "prop-sls",
      name: "碎灵石",
    });
    expect(parenResolver("碎灵石(基础道具)")).toEqual({
      kind: "prop",
      id: "prop-sls",
      name: "碎灵石",
    });
    // 复合名+括注:前段剥括注后命中
    expect(parenResolver("碎灵石(基础道具)·测灵状态")).toEqual({
      kind: "prop",
      id: "prop-sls",
      name: "碎灵石",
    });
  });

  it("1013 裁定钉板:倒序/近似变体仍不中(互含放宽被反例否决,归 prompt 侧)", () => {
    // 装机实弹未匹配3 之二:断剑归元(倒序)与客栈柴房(近似)机械无解——锁死防后人放宽
    const orderResolver = buildEntityResolver(
      [],
      [{ id: "scene-yuelai", name: "悦来客栈" }],
      [{ id: "prop-guiyuan", name: "归元断剑" }],
    );
    expect(orderResolver("断剑归元·余温态")).toBeNull();
    expect(orderResolver("客栈柴房·夜")).toBeNull();
  });

  it("降级命中时行名组装=规范名+state 两段式全长,parentId 指真实父", () => {
    const { characterSink, sceneSink, propSink, calls } = makeSinks();
    const { created, summary } = syncDerivedAssets(
      [{ parentAssetId: "青铜灯·门帘油灯灶房", state: "门帘油灯灶房", reason: "Sc9 夜戏定场" }],
      {
        projectId: "proj-1",
        resolver: buildEntityResolver([], [], [{ id: "prop-001", name: "青铜灯" }]),
        characterSink,
        sceneSink,
        propSink,
      },
    );
    expect(summary.created).toBe(1);
    expect(calls.addProp[0]).toMatchObject({
      name: "青铜灯·门帘油灯灶房",
      parentId: "prop-001",
      category: "门帘油灯灶房",
    });
    expect(created[0]?.parentAssetId).toBe("prop-001");
  });

  it("联合:手术后批次行名(青盐鞭)复合 parentAssetId 经 sync 落真实父链", () => {
    const { characterSink, sceneSink, propSink, calls } = makeSinks();
    const { created, summary } = syncDerivedAssets(
      [{ parentAssetId: "青盐鞭·抽灵与收束状态", state: "抽灵与收束状态", reason: "1-5 抽灵鞭击" }],
      {
        projectId: "proj-1",
        resolver: compositeResolver,
        characterSink,
        sceneSink,
        propSink,
      },
    );
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(calls.addProp[0]).toMatchObject({
      name: "青盐鞭·抽灵与收束状态",
      parentId: "prop-qingyanbian",
      category: "抽灵与收束状态",
    });
    expect(created[0]?.parentAssetId).toBe("prop-qingyanbian");
  });

  it("visibleProps 迁移 cross-check:手术后道具行名可整名解析(不断链)", () => {
    // 迁移后的 props 库行名=规范名(青盐鞭),resolver 由批次行构建可整名命中
    const migratedResolver = buildEntityResolver([], [], [{ id: "prop-qingyanbian", name: "青盐鞭" }]);
    expect(migratedResolver("青盐鞭")).toEqual({
      kind: "prop",
      id: "prop-qingyanbian",
      name: "青盐鞭",
    });
  });
});
