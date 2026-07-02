import { describe, expect, it } from "vitest";
import { syncExtractedEntities, type CharacterSink, type SceneSink } from "./entity-sync";
import type { DedupedEntity } from "./entity-extraction";

function makeSinks() {
  const calls = {
    addCharacter: [] as any[],
    updateCharacter: [] as Array<{ id: string; updates: any }>,
    addScene: [] as any[],
    updateScene: [] as Array<{ id: string; updates: any }>,
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
  it("creates new entities, reuses known ids, routes props to the batch record, returns mapping + counts", () => {
    const entities: DedupedEntity[] = [
      { id: null, isNew: true, kind: "character", name: "小红", aliases: ["红儿"], episodeIds: ["ep1"] },
      { id: "char-001", isNew: false, kind: "character", name: "小明", aliases: [], episodeIds: ["ep1"] },
      { id: null, isNew: true, kind: "scene", name: "咖啡厅", aliases: [], episodeIds: ["ep1"] },
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
    expect(calls.updateCharacter[0]?.updates.linkedEpisodeId).toBe("ep1");

    // scene created
    const cafe = result.scenes.find((s) => s.name === "咖啡厅");
    expect(cafe?.sceneId).toBe("scene_new_1");
    expect(calls.addScene).toHaveLength(1);
    expect(calls.addScene[0]?.folderId).toBe("scene_folder_1");

    // prop stays lightweight: no store call, deterministic assetId
    const ledger = result.props.find((p) => p.name === "账册");
    expect(ledger?.assetId).toBeTruthy();

    // counts
    expect(summary.created).toBe(3); // 小红 + 咖啡厅 + 账册
    expect(summary.merged).toBe(1); // 小明
  });
});
