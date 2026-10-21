// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import {
  createMystudioSinks,
  syncExtractedEntities,
  type CharacterSink,
  type SceneSink,
  type SyncExtractedEntity,
} from "./entity-sync";
import type { DedupedEntity } from "./entity-extraction";

function makeSinks() {
  const calls = {
    addCharacter: [] as Array<Parameters<CharacterSink["addCharacter"]>[0]>,
    updateCharacter: [] as Array<{ id: string; updates: Record<string, unknown> }>,
    addScene: [] as Array<Parameters<SceneSink["addScene"]>[0]>,
    updateScene: [] as Array<{ id: string; updates: Record<string, unknown> }>,
    charFolder: [] as Array<[string, string]>,
    sceneFolder: [] as Array<[string, string]>,
  };
  let charSeq = 0;
  let sceneSeq = 0;

  const characterSink: CharacterSink = {
    addCharacter: (input) => {
      calls.addCharacter.push(input);
      return `char_new_${++charSeq}`;
    },
    updateCharacter: (id, updates) => {
      calls.updateCharacter.push({ id, updates });
    },
    getOrCreateProjectFolder: (projectId, projectName) => {
      calls.charFolder.push([projectId, projectName]);
      return "char_folder_1";
    },
  };

  const sceneSink: SceneSink = {
    addScene: (input) => {
      calls.addScene.push(input);
      return `scene_new_${++sceneSeq}`;
    },
    updateScene: (id, updates) => {
      calls.updateScene.push({ id, updates });
    },
    getOrCreateProjectFolder: (projectId, projectName) => {
      calls.sceneFolder.push([projectId, projectName]);
      return "scene_folder_1";
    },
  };

  return { characterSink, sceneSink, calls };
}

describe("studio entity sync bridge", () => {
  beforeEach(() => {
    delete window.studioAssets;
    useCharacterLibraryStore.setState({
      characters: [],
      folders: [],
      currentFolderId: null,
    });
    useSceneStore.setState({
      scenes: [],
      folders: [],
      currentFolderId: null,
    });
    usePropsLibraryStore.setState({
      items: [],
      folders: [],
      selectedFolderId: "all",
    });
  });

  it("creates new entities, reuses known ids, routes props to the batch record, returns mapping + counts", () => {
    const entities: DedupedEntity[] = [
      { id: null, isNew: true, kind: "character", name: "小红", aliases: ["红儿"], episodeIds: ["ep1"] },
      { id: "char-001", isNew: false, kind: "character", name: "小明", aliases: [], episodeIds: ["ep1"] },
      { id: null, isNew: true, kind: "scene", name: "咖啡厅", aliases: ["咖啡馆"], episodeIds: ["ep1"] },
      { id: null, isNew: true, kind: "prop", name: "账册", aliases: ["旧账本"], episodeIds: ["ep1"] },
    ];

    const { characterSink, sceneSink, calls } = makeSinks();

    const { result, summary } = syncExtractedEntities(
      { episodeId: "ep1", entities, projectId: "proj-1", projectName: "测试项目" },
      { characterSink, sceneSink },
    );

    // batch record
    expect(result.episodeId).toBe("ep1");
    expect(result.id).toBeTruthy();
    expect(result.characters).toHaveLength(2);
    expect(result.scenes).toHaveLength(1);
    expect(result.props).toHaveLength(1);

    // new character → addCharacter, mapped to returned id, aliases preserved in batch
    const xiaohong = result.characters.find((c) => c.name === "小红");
    expect(xiaohong?.characterId).toBe("char_new_1");
    expect(xiaohong?.aliases).toEqual(["红儿"]);

    // known character → updateCharacter with original id, NOT addCharacter
    const xiaoming = result.characters.find((c) => c.name === "小明");
    expect(xiaoming?.characterId).toBe("char-001");
    expect(calls.addCharacter).toHaveLength(1);
    expect(calls.updateCharacter).toHaveLength(1);
    expect(calls.updateCharacter[0]?.id).toBe("char-001");

    // created entities carry the episode link + project folder
    expect(calls.addCharacter[0]?.linkedEpisodeId).toBe("ep1");
    expect(calls.addCharacter[0]?.folderId).toBe("char_folder_1");
    expect(calls.addCharacter[0]?.assetName).toBe("小红;红儿");
    // D11 随动(10-19 C1 Step 10):linkedEpisodeId 语义=firstChapterId,已入库实体
    // 不再被最近章覆盖——update 载荷不再携带 linkedEpisodeId(旧断言 updates.linkedEpisodeId==="ep1"
    // 锚的是「覆盖为最近章」旧语义,随动删除)。

    // scene created; aliases persist in the batch record (10-20 修)
    const cafe = result.scenes.find((s) => s.name === "咖啡厅");
    expect(cafe?.sceneId).toBe("scene_new_1");
    expect(cafe?.aliases).toEqual(["咖啡馆"]);
    expect(calls.addScene).toHaveLength(1);
    expect(calls.addScene[0]?.folderId).toBe("scene_folder_1");

    // prop stays lightweight: no store call, deterministic assetId; aliases persist
    const ledger = result.props.find((p) => p.name === "账册");
    expect(ledger?.assetId).toBeTruthy();
    expect(ledger?.aliases).toEqual(["旧账本"]);

    // counts
    expect(summary.created).toBe(3); // 小红 + 咖啡厅 + 账册
    expect(summary.merged).toBe(1); // 小明
  });

  it("does not clobber library notes when the merged alias union is empty (1013 修)", () => {
    // merged 且并集别名为空 → updateCharacter 的 updates 不含 notes 键:
    // updateCharacter 是 {...char,...updates} 浅展开,发 notes:undefined 会抹掉库内既有备注
    const entities: DedupedEntity[] = [
      { id: "char-001", isNew: false, kind: "character", name: "小明", aliases: [], episodeIds: ["ep1"] },
    ];
    const { characterSink, sceneSink, calls } = makeSinks();

    syncExtractedEntities(
      { episodeId: "ep1", entities, projectId: "proj-1", projectName: "测试项目" },
      { characterSink, sceneSink },
    );

    expect(calls.updateCharacter).toHaveLength(1);
    expect(Object.keys(calls.updateCharacter[0]!.updates)).not.toContain("notes");
    expect(calls.updateCharacter[0]!.updates.status).toBe("linked");
    // D11 随动:同上,update 不再覆盖 linkedEpisodeId(旧断言 ==="ep1" 随动删除)
    expect(Object.keys(calls.updateCharacter[0]!.updates)).not.toContain("linkedEpisodeId");
  });

  it("overwrites notes with the union aliases when the merged alias union is non-empty", () => {
    const entities: DedupedEntity[] = [
      {
        id: "char-001",
        isNew: false,
        kind: "character",
        name: "赵四",
        aliases: ["赵四", "监工", "监工老爷"],
        episodeIds: ["ep1"],
      },
    ];
    const { characterSink, sceneSink, calls } = makeSinks();

    syncExtractedEntities(
      { episodeId: "ep1", entities, projectId: "proj-1", projectName: "测试项目" },
      { characterSink, sceneSink },
    );

    expect(calls.updateCharacter).toHaveLength(1);
    expect(calls.updateCharacter[0]!.updates.notes).toBe("别名：赵四、监工、监工老爷");
  });

  it("keeps workflow entity sync project-scoped and does not write the independent asset library", () => {
    window.studioAssets = {
      getByName: vi.fn(),
      add: vi.fn(),
    } as unknown as NonNullable<Window["studioAssets"]>;
    const sinks = createMystudioSinks();

    sinks.characterSink.addCharacter({
      name: "独孤剑尘",
      description: "白衣剑修",
      visualTraits: "",
      projectId: "dao-project",
    });
    sinks.sceneSink.addScene({
      name: "矿场",
      location: "矿场",
      time: "夜",
      atmosphere: "冷雨",
      projectId: "dao-project",
    });
    sinks.propSink?.addProp({
      name: "断剑",
      description: "一柄断裂的古剑",
      projectId: "dao-project",
    });

    expect(window.studioAssets?.getByName).not.toHaveBeenCalled();
    expect(window.studioAssets?.add).not.toHaveBeenCalled();
    expect(useCharacterLibraryStore.getState().characters[0]?.projectId).toBe("dao-project");
    expect(useSceneStore.getState().scenes[0]?.projectId).toBe("dao-project");
    expect(usePropsLibraryStore.getState().items[0]?.projectId).toBe("dao-project");
  });

  // ── 10-19 C1 Step 10:D11 linkedEpisodeId=firstChapterId + D10 晋升过滤 ──

  it("D11:新增实体 linkedEpisodeId 取 firstEpisodeId(首次出场章),缺省回落本批 episodeId", () => {
    const entities: SyncExtractedEntity[] = [
      {
        id: null,
        isNew: true,
        kind: "character",
        name: "林晚",
        aliases: [],
        episodeIds: ["ep2"],
        firstEpisodeId: "ep1",
      },
      {
        id: null,
        isNew: true,
        kind: "character",
        name: "无首章信息者",
        aliases: [],
        episodeIds: ["ep2"],
      },
    ];
    const { characterSink, sceneSink, calls } = makeSinks();

    syncExtractedEntities(
      { episodeId: "ep2", entities, projectId: "proj-1", projectName: "测试项目" },
      { characterSink, sceneSink },
    );

    expect(calls.addCharacter).toHaveLength(2);
    expect(calls.addCharacter.find((input) => input.name === "林晚")).toMatchObject({
      linkedEpisodeId: "ep1",
    });
    expect(calls.addCharacter.find((input) => input.name === "无首章信息者")).toMatchObject({
      linkedEpisodeId: "ep2",
    });
  });

  it("D10 晋升过滤:promoted=false 的角色/场景不入三库(确定性伪 id 留批),道具不写道具库", () => {
    const entities: SyncExtractedEntity[] = [
      {
        id: null,
        isNew: true,
        kind: "character",
        name: "林晚",
        aliases: [],
        episodeIds: ["ep1"],
        promoted: false,
      },
      {
        id: null,
        isNew: true,
        kind: "scene",
        name: "山门",
        aliases: ["山门旧址"],
        episodeIds: ["ep1"],
        promoted: false,
      },
      {
        id: null,
        isNew: true,
        kind: "prop",
        name: "长剑",
        aliases: ["青锋剑"],
        episodeIds: ["ep1"],
        promoted: false,
      },
    ];
    const { characterSink, sceneSink, calls } = makeSinks();
    const addProp = vi.fn(() => "prop_new_1");

    const { result, summary } = syncExtractedEntities(
      { episodeId: "ep1", entities, projectId: "proj-1", projectName: "测试项目" },
      { characterSink, sceneSink, propSink: { addProp } },
    );

    // 三库零写
    expect(calls.addCharacter).toHaveLength(0);
    expect(calls.updateCharacter).toHaveLength(0);
    expect(calls.addScene).toHaveLength(0);
    expect(calls.updateScene).toHaveLength(0);
    expect(addProp).not.toHaveBeenCalled();
    // 批内留痕:确定性伪 id(资产页按章展示不空)
    expect(result.characters[0]).toMatchObject({
      name: "林晚",
      characterId: "char-ep1-1",
      aliases: [],
    });
    expect(result.scenes[0]).toMatchObject({
      name: "山门",
      sceneId: "scene-ep1-1",
      aliases: ["山门旧址"],
    });
    expect(result.props[0]).toMatchObject({ name: "长剑", aliases: ["青锋剑"] });
    expect(result.props[0]?.assetId).toMatch(/^prop-ep1-\d+$/);
    // 计数:deferred 独立,不算 created/merged
    expect(summary).toMatchObject({ created: 0, merged: 0, deferred: 3 });
  });
});
