// @vitest-environment jsdom
/**
 * 批4 分镜素材自动绑定测试(10-11 pipeline-human-node-automation,D2 真口径):
 * 匹配(唯一/多义/零命中/缺图/别名+模糊)→ bindAssetImageAsKeyframe
 * (受管路径复制+I1 双写+I4 校验复用,违反不硬写)→ 章编排(就绪度计数/
 * 缺图触发批2 补图/例外清单)→ 例外单镜重试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { saveImageToLocal } from "@/lib/media/image-storage";
import { useCharacterLibraryStore, type Character } from "@/stores/library/character-library-store";
import { usePropsLibraryStore, type PropItem } from "@/stores/library/props-library-store";
import { useSceneStore, type Scene } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { EntityExtractionResult, StoryboardItem } from "@/types/studio";
import {
  computeChapterScriptFingerprint,
  currentScriptFingerprintSnapshot,
} from "./chapter-pipeline-stale";
import type { AssetRow } from "./script-asset-generation-model";
import {
  bindAssetImageAsKeyframe,
  matchStoryboardBindingAsset,
  retryStoryboardBindingShot,
  runStoryboardAssetBinding,
  storyboardHasVisual,
  useStoryboardBindingStore,
} from "./storyboard-asset-binding";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi.fn().mockResolvedValue("local-image://shots/bound.png"),
  getAbsoluteImagePath: vi.fn().mockResolvedValue(null),
  resolveImagePath: vi.fn((path: string) => path),
}));

const CHAPTER_ID = "chapter-001";
const PROJECT_ID = "proj-1";

function sceneAsset(overrides: Partial<Scene> = {}): Scene {
  return {
    id: "scene-1",
    name: "夜市街口",
    location: "夜市",
    time: "夜",
    atmosphere: "嘈杂",
    projectId: PROJECT_ID,
    referenceImage: "local-image://scenes/night-market.png",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function characterAsset(overrides: Partial<Character> = {}): Character {
  return {
    id: "char-1",
    name: "断臂散修",
    description: "断臂老修士",
    visualTraits: "",
    projectId: PROJECT_ID,
    views: [],
    variations: [],
    thumbnailUrl: "local-image://characters/hero.png",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function propAsset(overrides: Partial<PropItem> = {}): PropItem {
  return {
    id: "prop-1",
    name: "断剑",
    description: "残断古剑",
    imageUrl: "local-image://props/sword.png",
    folderId: null,
    projectId: PROJECT_ID,
    createdAt: 1,
    ...overrides,
  };
}

const SCENE_ROW: AssetRow = {
  type: "scene",
  id: "scene-1",
  name: "夜市街口",
  asset: sceneAsset(),
};

const HERO_ROW: AssetRow = {
  type: "character",
  id: "char-1",
  name: "断臂散修",
  asset: characterAsset(),
};

const PROP_ROW: AssetRow = {
  type: "prop",
  id: "prop-1",
  name: "断剑",
  asset: propAsset(),
};

/** 缺图场景行(无 referenceImage)——批2 补图链的对照 fixture。 */
function bareSceneRow(): { row: AssetRow; asset: Scene } {
  const asset = sceneAsset({
    id: "scene-bare",
    name: "破庙",
    location: "古庙",
    referenceImage: undefined,
  });
  return { row: { type: "scene", id: asset.id, name: asset.name, asset }, asset };
}

function makeShot(input: {
  index: number;
  associateAssetsNames: string[];
  mediaRef?: StoryboardItem["mediaRef"];
  keyframes?: StoryboardItem["keyframes"];
}): StoryboardItem {
  return {
    id: `sb-${CHAPTER_ID}-${String(input.index).padStart(3, "0")}`,
    episodeId: CHAPTER_ID,
    index: input.index,
    trackKey: `001-${input.index}`,
    trackId: "",
    duration: 5,
    prompt: "画面描述",
    videoDesc: "",
    assetIds: [],
    associateAssetsNames: input.associateAssetsNames,
    mediaRef: input.mediaRef,
    keyframes: input.keyframes,
    shouldGenerateImage: true,
    state: "idle",
  } as StoryboardItem;
}

function boundImageRef(path: string): StoryboardItem["mediaRef"] {
  return { kind: "image", path };
}

// ── 1013 修 RC-6 fixtures:兜底绑定+非精确命中例外 ──────────────────────────
const YOUNG_LABORER_ROW: AssetRow = {
  type: "character",
  id: "char-young",
  name: "年轻苦力",
  asset: characterAsset({ id: "char-young", name: "年轻苦力" }),
};

const INN_ROW: AssetRow = {
  type: "scene",
  id: "scene-inn",
  name: "悦来客栈",
  asset: sceneAsset({ id: "scene-inn", name: "悦来客栈", location: "悦来客栈" }),
};

const FOREMAN_ROW: AssetRow = {
  type: "character",
  id: "char-foreman",
  name: "监工赵四",
  asset: characterAsset({ id: "char-foreman", name: "监工赵四" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).projectFiles;
  useStudioStore.getState().resetStudioWorkflow();
  for (const store of [usePropsLibraryStore, useCharacterLibraryStore, useSceneStore]) {
    (store as unknown as { persist?: { setOptions: (o: unknown) => void } }).persist?.setOptions({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
  }
  useSceneStore.setState({ scenes: [], folders: [], currentFolderId: null });
  useCharacterLibraryStore.setState({
    characters: [],
    folders: [],
    currentFolderId: null,
    selectedCharacterId: null,
  });
  usePropsLibraryStore.setState({ items: [], folders: [], selectedFolderId: "all" });
  useStoryboardBindingStore.setState({ runsByChapter: {} });
  vi.mocked(saveImageToLocal).mockResolvedValue("local-image://shots/bound.png");
});

describe("匹配(纯规则):asset-matching 名+别名+模糊", () => {
  const rows = [SCENE_ROW, HERO_ROW, PROP_ROW];

  it("场景唯一命中=unique(场景在前惯例)", () => {
    const match = matchStoryboardBindingAsset({
      names: ["夜市街口", "断臂散修"],
      rows,
    });
    expect(match.status).toBe("unique");
    if (match.status === "unique") {
      expect(match.row.type).toBe("scene");
      expect(match.image).toBe("local-image://scenes/night-market.png");
    }
  });

  it("场景零命中→角色唯一命中(降级链)", () => {
    const match = matchStoryboardBindingAsset({ names: ["断臂散修"], rows });
    expect(match.status).toBe("unique");
    if (match.status === "unique") expect(match.row.type).toBe("character");
  });

  it("场景/角色零命中→道具兜底", () => {
    const match = matchStoryboardBindingAsset({ names: ["断剑"], rows });
    expect(match.status).toBe("unique");
    if (match.status === "unique") expect(match.row.type).toBe("prop");
  });

  it("同类型多命中=多义(人拣,不猜)", () => {
    const twinScene: AssetRow = { ...SCENE_ROW, id: "scene-2", name: "夜市街口西" };
    const match = matchStoryboardBindingAsset({
      names: ["夜市街口"],
      rows: [SCENE_ROW, twinScene, HERO_ROW],
    });
    expect(match.status).toBe("ambiguous");
    if (match.status === "ambiguous") {
      expect(match.type).toBe("scene");
      expect(match.candidateNames).toEqual(["夜市街口", "夜市街口西"]);
    }
  });

  it("唯一命中但无图=缺图(触发补图再绑)", () => {
    const { row: noImageScene } = bareSceneRow();
    const match = matchStoryboardBindingAsset({ names: ["破庙"], rows: [noImageScene] });
    expect(match.status).toBe("missing-image");
  });

  it("角色别名命中(实体提取批次别名表)", () => {
    const match = matchStoryboardBindingAsset({
      names: ["李先生"],
      rows: [HERO_ROW, { ...HERO_ROW, id: "char-2", name: "李先生;管事" }],
      characterAliases: { "李先生;管事": ["李先生"] },
    });
    expect(match.status).toBe("unique");
    if (match.status === "unique") expect(match.row.name).toBe("李先生;管事");
  });

  it("模糊包含命中(「赵四」↔「监工赵四」)", () => {
    const match = matchStoryboardBindingAsset({
      names: ["赵四"],
      rows: [HERO_ROW, { ...HERO_ROW, id: "char-3", name: "监工赵四" }],
    });
    expect(match.status).toBe("unique");
    if (match.status === "unique") expect(match.row.name).toBe("监工赵四");
  });

  it("空引用/零命中=no-match", () => {
    expect(matchStoryboardBindingAsset({ names: [], rows }).status).toBe("no-match");
    expect(
      matchStoryboardBindingAsset({ names: ["不存在的资产"], rows }).status,
    ).toBe("no-match");
  });
});

describe("1013 修 RC-6:unique 分支非精确命中名(unmatchedNames)", () => {
  it("①全精确命中→unmatchedNames=[]", () => {
    const match = matchStoryboardBindingAsset({
      names: ["悦来客栈", "监工赵四"],
      rows: [FOREMAN_ROW, INN_ROW],
      characterAliases: { 监工赵四: ["赵四"] },
    });
    expect(match.status).toBe("unique");
    if (match.status === "unique") {
      expect(match.unmatchedNames).toEqual([]);
      expect(match.row.type).toBe("scene");
    }
  });

  it("②零命中名(独孤剑尘)+别名包含命中名(老苦力⊃苦力)→unique 且两者均入 unmatchedNames", () => {
    const match = matchStoryboardBindingAsset({
      names: ["独孤剑尘", "老苦力"],
      rows: [YOUNG_LABORER_ROW],
      characterAliases: { 年轻苦力: ["苦力"] },
    });
    expect(match.status).toBe("unique");
    if (match.status === "unique") {
      expect(match.row.name).toBe("年轻苦力");
      expect(match.unmatchedNames).toEqual(["独孤剑尘", "老苦力"]);
    }
  });

  it("③names=[客栈]:悦来客栈 包含命中(场景在前)+监工赵四别名层不再恒命中→unique 且 unmatchedNames=[客栈]", () => {
    // 修复前:别名「赵四」是主名「监工赵四」子串→任意名字(含客栈)恒命中
    // 监工赵四→批次贫瘠时每镜错绑兜底;修复后仅悦来客栈 包含命中
    const match = matchStoryboardBindingAsset({
      names: ["客栈"],
      rows: [FOREMAN_ROW, INN_ROW],
      characterAliases: { 监工赵四: ["赵四"] },
    });
    expect(match.status).toBe("unique");
    if (match.status === "unique") {
      expect(match.row.name).toBe("悦来客栈");
      expect(match.unmatchedNames).toEqual(["客栈"]);
    }
  });
});

describe("bindAssetImageAsKeyframe:关键帧管线(I1/I4)", () => {
  function mockProjectBridge(url = "project-file://proj-1/workflow-images/chapter-001/bindings/sb-001/asset-1.png") {
    (window as unknown as Record<string, unknown>).projectFiles = {
      saveImage: vi.fn().mockResolvedValue({ success: true, url, size: 4321 }),
      getAbsolutePath: vi.fn().mockResolvedValue("/abs/bindings/asset.png"),
    };
  }

  it("项目内:复制进章节媒体库 bindings 子树→kf-1 首帧→I1 双写(mediaRef≡keyframes[0])", async () => {
    mockProjectBridge();
    const shot = makeShot({ index: 1, associateAssetsNames: ["夜市街口"] });
    useStudioStore.setState({ storyboards: [shot] });

    const result = await bindAssetImageAsKeyframe({
      storyboardId: shot.id,
      asset: { type: "scene", name: "夜市街口", image: "local-image://scenes/night-market.png" },
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
    });

    expect(result.ok).toBe(true);
    // 复制走 projectFile 桥,落 workflow-images/{chapterId}/bindings/{storyboardId}/
    const bridge = (window as unknown as { projectFiles: { saveImage: ReturnType<typeof vi.fn> } })
      .projectFiles;
    expect(bridge.saveImage).toHaveBeenCalledOnce();
    const payload = bridge.saveImage.mock.calls[0][0] as { relativePath: string; source: string };
    expect(payload.relativePath).toContain("workflow-images/chapter-001/bindings/sb-chapter-001-001/");
    expect(payload.source).toBe("local-image://scenes/night-market.png");

    const bound = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
    // I1:mediaRef 与 keyframes[0].mediaRef 同源双写
    expect(bound?.mediaRef).toEqual({
      kind: "image",
      path: "project-file://proj-1/workflow-images/chapter-001/bindings/sb-001/asset-1.png",
    });
    expect(bound?.keyframes?.[0]?.mediaRef).toBe(bound?.mediaRef);
    expect(bound?.keyframes?.[0]).toMatchObject({
      frameId: `${shot.id}-kf-1`,
      inUs: 0,
    });
    // 媒体落地即 ready(关键帧管线既有语义)
    expect(bound?.state).toBe("ready");
    // 章节媒体库登记(material 台账)
    expect(
      useStudioStore.getState().materials.some(
        (item) => item.localPath === bound?.mediaRef?.path,
      ),
    ).toBe(true);
  });

  it("非项目环境回落本机媒体库 shots 分类;保存通道回未持久化地址=fail-closed 拒绑", async () => {
    const shot = makeShot({ index: 2, associateAssetsNames: ["断剑"] });
    useStudioStore.setState({ storyboards: [shot] });
    // saveImageToLocal fail-open 原样返回云端 URL(批0a 教训形态)
    vi.mocked(saveImageToLocal).mockResolvedValue("https://cdn.example/original.png");

    const result = await bindAssetImageAsKeyframe({
      storyboardId: shot.id,
      asset: { type: "prop", name: "断剑", image: "local-image://props/sword.png" },
      chapterId: CHAPTER_ID,
      projectId: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("未持久化地址");
    // 不硬写:分镜保持无画面
    const bound = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
    expect(bound?.mediaRef).toBeUndefined();
    expect(bound?.keyframes).toBeUndefined();
  });

  it("回落成功:local-image:// 受管路径过 I4,绑定成立", async () => {
    const shot = makeShot({ index: 3, associateAssetsNames: ["断剑"] });
    useStudioStore.setState({ storyboards: [shot] });

    const result = await bindAssetImageAsKeyframe({
      storyboardId: shot.id,
      asset: { type: "prop", name: "断剑", image: "local-image://props/sword.png" },
      chapterId: CHAPTER_ID,
      projectId: null,
    });

    expect(result.ok).toBe(true);
    const bound = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
    expect(bound?.mediaRef?.path).toBe("local-image://shots/bound.png");
  });

  it("多帧镜:只补首帧槽,其余帧保留不覆盖", async () => {
    mockProjectBridge();
    const shot = makeShot({
      index: 4,
      associateAssetsNames: ["夜市街口"],
      keyframes: [
        { frameId: `${CHAPTER_ID}-kf-1`, mediaRef: undefined as never, inUs: 0 },
        {
          frameId: `${CHAPTER_ID}-kf-2`,
          mediaRef: { kind: "image", path: "local-image://shots/frame-2.png" },
          inUs: 2_500_000,
        },
      ],
    });
    useStudioStore.setState({ storyboards: [shot] });

    const result = await bindAssetImageAsKeyframe({
      storyboardId: shot.id,
      asset: { type: "scene", name: "夜市街口", image: "local-image://scenes/night-market.png" },
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
    });

    expect(result.ok).toBe(true);
    const bound = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
    expect(bound?.keyframes).toHaveLength(2);
    expect(bound?.keyframes?.[1]?.mediaRef?.path).toBe("local-image://shots/frame-2.png");
    expect(bound?.keyframes?.[0]?.mediaRef?.path).toContain("bindings");
  });

  it("keyframes.ts 既有校验不过=例外不硬写(I4 复用的反向验证)", async () => {
    mockProjectBridge();
    // 预置非法帧序列(第 2 帧 inUs 未严格递增):补首帧后整序仍非法→拒绑
    const shot = makeShot({
      index: 5,
      associateAssetsNames: ["夜市街口"],
      keyframes: [
        { frameId: "kf-1", mediaRef: undefined as never, inUs: 0 },
        { frameId: "kf-2", mediaRef: { kind: "image", path: "local-image://shots/bad.png" }, inUs: 0 },
      ],
    });
    useStudioStore.setState({ storyboards: [shot] });

    const result = await bindAssetImageAsKeyframe({
      storyboardId: shot.id,
      asset: { type: "scene", name: "夜市街口", image: "local-image://scenes/night-market.png" },
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("关键帧校验未过");
    const bound = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
    expect(bound?.mediaRef).toBeUndefined();
    expect(bound?.keyframes?.[0]?.mediaRef).toBeUndefined();
  });
});

describe("就绪度判定", () => {
  it("video 落账/image mediaRef/首帧关键帧有图=有画面;三者皆无=待绑", () => {
    expect(storyboardHasVisual({ mediaRef: { kind: "video", path: "local-image://videos/v.mp4" } })).toBe(true);
    expect(storyboardHasVisual({ mediaRef: { kind: "image", path: "local-image://shots/a.png" } })).toBe(true);
    expect(
      storyboardHasVisual({
        mediaRef: undefined,
        keyframes: [{ frameId: "k", mediaRef: { kind: "image", path: "local-image://shots/b.png" }, inUs: 0 }],
      }),
    ).toBe(true);
    expect(storyboardHasVisual({ mediaRef: undefined })).toBe(false);
    expect(storyboardHasVisual({ mediaRef: { kind: "image", path: "" } })).toBe(false);
  });
});

describe("章级编排:runStoryboardAssetBinding", () => {
  function seedChapter(input: {
    shots: StoryboardItem[];
    rows: AssetRow[];
    aliases?: Record<string, string[]>;
  }) {
    const extraction: EntityExtractionResult = {
      id: "extract-1",
      episodeId: CHAPTER_ID,
      sourceId: "src-1",
      revision: 1,
      characters: input.rows
        .filter((row) => row.type === "character")
        .map((row) => ({
          characterId: row.id,
          name: row.name,
          aliases: input.aliases?.[row.name] ?? [],
        })),
      scenes: input.rows
        .filter((row) => row.type === "scene")
        .map((row) => ({ sceneId: row.id, name: row.name })),
      props: input.rows
        .filter((row) => row.type === "prop")
        .map((row) => ({ assetId: row.id, name: row.name })),
    };
    useStudioStore.setState({
      storyboards: input.shots,
      entityExtractions: [extraction],
    });
    // buildChapterAssetRows 从三库回填 asset:行注入对应库
    useSceneStore.setState({
      scenes: input.rows
        .filter((row) => row.type === "scene" && row.asset)
        .map((row) => row.asset as never),
      folders: [],
      currentFolderId: null,
    });
    useCharacterLibraryStore.setState({
      characters: input.rows
        .filter((row) => row.type === "character" && row.asset)
        .map((row) => row.asset as never),
      folders: [],
      currentFolderId: null,
      selectedCharacterId: null,
    });
    usePropsLibraryStore.setState({
      items: input.rows
        .filter((row) => row.type === "prop" && row.asset)
        .map((row) => row.asset as never),
      folders: [],
      selectedFolderId: "all",
    });
  }

  function mockProjectBridge() {
    (window as unknown as Record<string, unknown>).projectFiles = {
      saveImage: vi.fn().mockImplementation(async ({ relativePath }: { relativePath: string }) => ({
        success: true,
        url: `project-file://proj-1/${relativePath}`,
        size: 100,
      })),
      getAbsolutePath: vi.fn().mockResolvedValue("/abs"),
    };
  }

  it("唯一命中绑成+多义进例外清单;就绪度计数更新", async () => {
    mockProjectBridge();
    seedChapter({
      shots: [
        makeShot({ index: 1, associateAssetsNames: ["夜市街口"] }),
        makeShot({ index: 2, associateAssetsNames: ["断臂散修"] }),
        makeShot({
          index: 3,
          associateAssetsNames: ["已绑"],
          mediaRef: boundImageRef("local-image://shots/existing.png"),
        }),
      ],
      rows: [SCENE_ROW, HERO_ROW],
    });

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });

    // 已绑镜(S3)不参与:total=2;S1/S2 绑成
    expect(report).toMatchObject({
      total: 2,
      boundCount: 2,
      readyBefore: 1,
      readyAfter: 3,
      exceptions: [],
    });
    const s1 = useStudioStore.getState().storyboards.find((item) => item.index === 1);
    expect(s1?.mediaRef?.path).toContain("bindings");
    expect(useStoryboardBindingStore.getState().runsByChapter[CHAPTER_ID]?.status).toBe("done");
  });

  it("多义/零命中进例外清单(可点处理:带候选名/命中详情)", async () => {
    mockProjectBridge();
    seedChapter({
      shots: [
        makeShot({ index: 1, associateAssetsNames: ["夜市街口"] }),
        makeShot({ index: 2, associateAssetsNames: ["神秘人"] }),
      ],
      rows: [SCENE_ROW, { ...SCENE_ROW, id: "scene-2", name: "夜市街口东" }],
    });

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });

    expect(report?.boundCount).toBe(0);
    expect(report?.exceptions).toHaveLength(2);
    const ambiguous = report?.exceptions.find((row) => row.status === "ambiguous");
    expect(ambiguous?.candidates).toEqual(["夜市街口", "夜市街口东"]);
    const noMatch = report?.exceptions.find((row) => row.status === "no-match");
    expect(noMatch?.detail).toContain("神秘人");
    expect(toast.warning).toHaveBeenCalled();
  });

  it("缺图=先触发批2 补图再绑(fill 注入:补上图后复配命中)", async () => {
    mockProjectBridge();
    const { row: bareScene, asset: bareAsset } = bareSceneRow();
    seedChapter({
      shots: [makeShot({ index: 1, associateAssetsNames: ["破庙"] })],
      rows: [bareScene],
    });
    const fill = vi.fn(async () => {
      // 批2 补图效果:场景行落上图(真实链=生图+写行;此处注入直写)
      useSceneStore.setState({
        scenes: [
          { ...bareAsset, referenceImage: "local-image://scenes/fixed-temple.png" },
        ],
        folders: [],
        currentFolderId: null,
      });
      return null;
    });

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      triggerAssetFill: fill,
    });

    expect(fill).toHaveBeenCalledOnce();
    expect(report?.fillTriggered).toBe(true);
    expect(report?.boundCount).toBe(1);
    const shot = useStudioStore.getState().storyboards.find((item) => item.index === 1);
    expect(shot?.mediaRef?.path).toContain("bindings");
  });

  it("G37/R7 补图过期门:批次盖戳≠现势剧本指纹→该行 failed「提取集过期」落账,fill 不发(不烧图)、不阻断其余行", async () => {
    mockProjectBridge();
    const { row: bareScene } = bareSceneRow();
    seedChapter({
      shots: [
        makeShot({ index: 1, associateAssetsNames: ["破庙"] }),
        makeShot({ index: 2, associateAssetsNames: ["夜市街口"] }),
      ],
      rows: [bareScene, SCENE_ROW],
    });
    // 批次盖戳按「提取时的旧剧本」真算(scriptPlanSourceFingerprint 同公式,
    // 防有戳即拦的退化假阳);现势 store 无 scriptDraft → 现势指纹≠旧戳=stale
    const oldStamp = computeChapterScriptFingerprint(CHAPTER_ID, {
      agentWorkData: [
        { key: "scriptDraft", episodeId: CHAPTER_ID, data: "# 提取时的旧剧本正文", updatedAt: 1 },
      ],
      novelChapters: [],
      scriptPlans: [],
    });
    useStudioStore.setState({
      entityExtractions: [
        { ...useStudioStore.getState().entityExtractions[0]!, scriptFingerprint: oldStamp },
      ],
    });
    const fill = vi.fn(async () => null);

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      triggerAssetFill: fill,
    });

    // 不烧图:fill 一次都不发,报表也认定未触发补图
    expect(fill).not.toHaveBeenCalled();
    expect(report?.fillTriggered).toBe(false);
    // stale 行 failed 落账:镜像既有失败模式(detail 带原因+命中资产锚)
    const stale = report?.exceptions.find((row) => row.status === "failed");
    expect(stale?.detail).toContain("提取集过期，请先重新提取资产");
    expect(stale?.matchedAssetName).toBe("破庙");
    // 不阻断其余行:S2 有图行照常绑成
    expect(report?.boundCount).toBe(1);
    const s2 = useStudioStore.getState().storyboards.find((item) => item.index === 2);
    expect(s2?.mediaRef?.path).toContain("bindings");
  });

  it("G37/R7 补图过期门:批次盖戳=现势指纹(刚提取)→照常触发 fill 补图", async () => {
    mockProjectBridge();
    const { row: bareScene, asset: bareAsset } = bareSceneRow();
    seedChapter({
      shots: [makeShot({ index: 1, associateAssetsNames: ["破庙"] })],
      rows: [bareScene],
    });
    // 盖戳=现势指纹(fresh):门禁放行,fill 照发
    useStudioStore.setState({
      entityExtractions: [
        {
          ...useStudioStore.getState().entityExtractions[0]!,
          scriptFingerprint: computeChapterScriptFingerprint(
            CHAPTER_ID,
            currentScriptFingerprintSnapshot(),
          ),
        },
      ],
    });
    const fill = vi.fn(async () => {
      useSceneStore.setState({
        scenes: [{ ...bareAsset, referenceImage: "local-image://scenes/fixed-temple.png" }],
        folders: [],
        currentFolderId: null,
      });
      return null;
    });

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      triggerAssetFill: fill,
    });

    expect(fill).toHaveBeenCalledOnce();
    expect(report?.fillTriggered).toBe(true);
    expect(report?.boundCount).toBe(1);
    const shot = useStudioStore.getState().storyboards.find((item) => item.index === 1);
    expect(shot?.mediaRef?.path).toContain("bindings");
  });

  it("缺图且补图后仍无图=例外(缺图);补图失败=例外(带原因)", async () => {
    mockProjectBridge();
    const { row: bareScene } = bareSceneRow();
    seedChapter({
      shots: [
        makeShot({ index: 1, associateAssetsNames: ["破庙"] }),
        makeShot({ index: 2, associateAssetsNames: ["破庙"] }),
      ],
      rows: [bareScene],
    });
    const fill = vi.fn(async () => {
      throw new Error("批2 一键生成失败");
    });

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      triggerAssetFill: fill,
    });

    expect(report?.exceptions).toHaveLength(2);
    expect(report?.exceptions.every((row) => row.status === "missing-image")).toBe(true);
    expect(report?.exceptions[0]?.detail).toContain("补图触发失败：批2 一键生成失败");
    // 补图只发一轮:两镜缺图只触发一次批2
    expect(fill).toHaveBeenCalledOnce();
  });

  it("video 落账镜跳过(不动视频镜的关键帧);无分镜/无行前置拦截", async () => {
    mockProjectBridge();
    seedChapter({
      shots: [
        makeShot({
          index: 1,
          associateAssetsNames: ["夜市街口"],
          mediaRef: { kind: "video", path: "local-image://videos/v.mp4" },
        }),
      ],
      rows: [SCENE_ROW],
    });

    const allBound = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });
    expect(allBound).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("均已有画面"));

    const noShots = await runStoryboardAssetBinding({
      chapterId: "chapter-empty",
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });
    expect(noShots).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("尚无分镜"));
  });

  it("例外单镜重试:修复后重绑成功,例外行摘除", async () => {
    mockProjectBridge();
    const { row: bareScene, asset: bareAsset } = bareSceneRow();
    seedChapter({
      shots: [makeShot({ index: 1, associateAssetsNames: ["破庙"] })],
      rows: [bareScene],
    });
    // 首轮:无视觉手册→缺图例外(无法补图)
    const first = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: undefined,
    });
    expect(first?.exceptions[0]?.status).toBe("missing-image");

    // 修好(行有图)后重试单镜
    useSceneStore.setState({
      scenes: [{ ...bareAsset, referenceImage: "local-image://scenes/fixed.png" }],
      folders: [],
      currentFolderId: null,
    });
    await retryStoryboardBindingShot({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      storyboardId: "sb-chapter-001-001",
    });

    const report = useStoryboardBindingStore.getState().runsByChapter[CHAPTER_ID]?.report;
    expect(report?.exceptions).toHaveLength(0);
    const shot = useStudioStore.getState().storyboards.find((item) => item.index === 1);
    expect(shot?.mediaRef?.path).toContain("bindings");
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("重绑成功"),
      expect.objectContaining({ id: expect.stringContaining("storyboard-binding-retry") }),
    );
  });

  it("防重入:同章在途并入", async () => {
    mockProjectBridge();
    seedChapter({
      shots: [makeShot({ index: 1, associateAssetsNames: ["夜市街口"] })],
      rows: [SCENE_ROW],
    });
    useStoryboardBindingStore.getState().startRun(CHAPTER_ID, 1);

    const second = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });

    expect(second).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("已并入在途批次"));
  });

  it("④1013 修 RC-6:兜底绑定=boundCount 计入 + partial-match 例外披露(不再静默)", async () => {
    mockProjectBridge();
    seedChapter({
      shots: [makeShot({ index: 1, associateAssetsNames: ["独孤剑尘", "老苦力"] })],
      rows: [YOUNG_LABORER_ROW],
      aliases: { 年轻苦力: ["苦力"] },
    });

    const report = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });

    // 绑定真实落账(兜底也是绑定)
    expect(report?.boundCount).toBe(1);
    const shot = useStudioStore.getState().storyboards.find((item) => item.index === 1);
    expect(shot?.mediaRef?.path).toContain("bindings");
    // 同时落 partial-match 例外行(披露不静默)
    expect(report?.exceptions).toHaveLength(1);
    expect(report?.exceptions[0]).toMatchObject({
      status: "partial-match",
      statusLabel: "部分命中（已兜底）",
      matchedAssetName: "年轻苦力",
      matchedAssetType: "character",
    });
    expect(report?.exceptions[0]?.detail).toContain("独孤剑尘、老苦力");
    expect(report?.exceptions[0]?.detail).toContain("已用「年轻苦力」兜底绑定");
  });

  it("⑤1013 修 RC-6:partial 行重试成功仍 partial→patchExceptionRow 保留(不摘除)", async () => {
    mockProjectBridge();
    seedChapter({
      shots: [makeShot({ index: 1, associateAssetsNames: ["独孤剑尘", "老苦力"] })],
      rows: [YOUNG_LABORER_ROW],
      aliases: { 年轻苦力: ["苦力"] },
    });

    const first = await runStoryboardAssetBinding({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
    });
    expect(first?.exceptions[0]?.status).toBe("partial-match");

    await retryStoryboardBindingShot({
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID,
      visualManualId: "ink",
      storyboardId: "sb-chapter-001-001",
    });

    // 仍 partial:例外行 patch 保留(披露不摘除),不因重绑成功而清掉
    const report = useStoryboardBindingStore.getState().runsByChapter[CHAPTER_ID]?.report;
    expect(report?.exceptions).toHaveLength(1);
    expect(report?.exceptions[0]?.status).toBe("partial-match");
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("重绑成功（兜底）"),
      expect.objectContaining({ id: expect.stringContaining("storyboard-binding-retry") }),
    );
  });
});
