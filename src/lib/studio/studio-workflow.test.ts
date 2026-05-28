import { describe, expect, it } from "vitest";
import { buildSkillContextPackage } from "@/lib/studio/context";
import { DAOJIE_VISUAL_MANUAL_ID, buildStudioManualsFromSkillFiles } from "@/lib/studio/manuals";
import { buildMediaRefFromMaterial, createMaterialRecord, inferMaterialKind } from "@/lib/studio/material";
import { validateVendorConfig, resolveModelBinding } from "@/lib/studio/model-config";
import {
  appendNovelChapters,
  buildNovelChapterMirror,
  parseNovelChapters,
  replaceNovelChapters,
} from "@/lib/studio/novel";
import { createEpisodeMergePlan, createTrackRenderPlan, groupStoryboardsIntoTracks } from "@/lib/studio/production";
import type { StoryboardItem, VendorConfig } from "@/types/studio";

describe("Manying Studio workflow core", () => {
  it("imports txt or markdown novels into stable chapter records", () => {
    const chapters = parseNovelChapters(
      `# 第一章 雨夜\n王离进城。\n\n## 第二章 旧账\n账房开门。`,
      { importedAt: 1710000000000 },
    );

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({
      id: "chapter-001",
      index: 1,
      title: "第一章 雨夜",
      sourceText: "王离进城。",
      importedAt: 1710000000000,
    });
    expect(chapters[1]?.title).toBe("第二章 旧账");
  });

  it("appends imported novel chapters without replacing existing chapters", () => {
    const existing = parseNovelChapters("第1章 旧章\n旧章正文。", {
      importedAt: 1710000000000,
      sourceName: "old.txt",
    });

    const chapters = appendNovelChapters(existing, "第2章 新章\n新章正文。", {
      importedAt: 1710000001000,
      sourceName: "new.txt",
    });

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({
      id: "chapter-001",
      index: 1,
      title: "第1章 旧章",
      sourceName: "old.txt",
    });
    expect(chapters[1]).toMatchObject({
      id: "chapter-002",
      index: 2,
      title: "第2章 新章",
      sourceName: "new.txt",
      volume: "正文卷",
    });
  });

  it("replaces imported novel chapters from the first chapter index", () => {
    const chapters = replaceNovelChapters("第9章 重建\n重建正文。", {
      importedAt: 1710000002000,
      sourceName: "replace.md",
    });

    expect(chapters).toEqual([
      expect.objectContaining({
        id: "chapter-001",
        index: 1,
        title: "第9章 重建",
        sourceName: "replace.md",
        volume: "正文卷",
      }),
    ]);
  });

  it("builds stable markdown mirror files for imported chapters", () => {
    const chapter = parseNovelChapters("第1章 雨夜\n王离进城。", {
      importedAt: 1710000000000,
      sourceName: "novel.txt",
    })[0]!;

    expect(buildNovelChapterMirror("project-1", chapter)).toEqual({
      key: "_p/project-1/novel/chapters/chapter-001.md",
      content: [
        "# 第1章 雨夜",
        "",
        "> 卷：正文卷",
        "> 来源：novel.txt",
        "",
        "王离进城。",
      ].join("\n"),
    });
  });

  it("includes analyzed event data in chapter mirror files", () => {
    const chapter = {
      ...parseNovelChapters("第1章 雨夜\n王离进城。", { importedAt: 1710000000000 })[0]!,
      eventSummary: "王离进入雨夜中的账房",
      eventState: "主线关系：强（主角入局）",
      eventRawOutput: "| 第1章 雨夜 | 王离 | 王离进入雨夜账房并发现账册异常 | 强（主角入局） | 高 | 45秒 | 悬疑 |",
    };

    expect(buildNovelChapterMirror("project-1", chapter).content).toContain("## 事件分析");
    expect(buildNovelChapterMirror("project-1", chapter).content).toContain("王离进入雨夜中的账房");
    expect(buildNovelChapterMirror("project-1", chapter).content).toContain("主线关系：强（主角入局）");
  });

  it("builds a dry-run skill context package from novel text and agent work data", () => {
    const chapters = parseNovelChapters("第1章 雨夜\n王离进城。\n第2章 旧账\n账房开门。", {
      importedAt: 1710000000000,
    });

    const context = buildSkillContextPackage({
      projectName: "长夜账房",
      taskKey: "scriptDraft",
      chapters: [
        { ...chapters[0]!, eventSummary: "王离进入雨夜中的账房", eventState: "主角发现账册缺页" },
        chapters[1]!,
      ],
      agentWorkData: [
        {
          id: "work-1",
          key: "storySkeleton",
          data: "第一集围绕账册缺页展开。",
          createdAt: 1710000000000,
          updatedAt: 1710000000000,
        },
      ],
    });

    expect(context.title).toBe("长夜账房 / scriptDraft");
    expect(context.markdown).toContain("王离进入雨夜中的账房");
    expect(context.markdown).toContain("第一集围绕账册缺页展开。");
    expect(context.modelExecution).toBe("disabled");
  });

  it("uses Daojie manuals from the stored skill catalog in the skill context package", () => {
    const context = buildSkillContextPackage({
      projectName: "道劫",
      taskKey: "storySkeleton",
      chapters: [],
      agentWorkData: [],
      createdAt: 1710000000000,
      workflowConfig: {
        visualManualId: DAOJIE_VISUAL_MANUAL_ID,
      },
      manualCatalog: {
        visual: buildStudioManualsFromSkillFiles("visual", [
          {
            relativePath: "art_skills/daojie_ink_guofeng/README.md",
            content: "# 水墨国风修仙\n\n三族灵气",
          },
          {
            relativePath: "art_skills/daojie_ink_guofeng/prefix.md",
            content: "万道归真",
          },
        ]),
      },
    });

    expect(context.markdown).toContain("水墨国风修仙");
    expect(context.markdown).toContain("三族灵气");
    expect(context.markdown).toContain("万道归真");
  });

  it("builds skill context packages from stored manual catalogs when provided", () => {
    const context = buildSkillContextPackage({
      projectName: "道劫",
      taskKey: "storySkeleton",
      chapters: [],
      agentWorkData: [],
      createdAt: 1710000000000,
      workflowConfig: {
        visualManualId: "local_visual",
        directorManualId: "local_director",
      },
      manualCatalog: {
        visual: [{
          id: "local_visual",
          kind: "visual",
          name: "本地视觉",
          modules: { README: "# 本地视觉", prefix: "本地视觉前缀" },
          images: [],
          builtin: false,
          source: "stored-copy",
          completenessScore: 2,
          moduleCount: 2,
          imageCount: 0,
        }],
        director: [{
          id: "local_director",
          kind: "director",
          name: "本地导演",
          modules: {
            README: "# 本地导演",
            director_planning_narrative: "本地导演规划规则",
            director_storyboard_table_narrative: "",
          },
          images: [],
          builtin: false,
          source: "stored-copy",
          completenessScore: 2,
          moduleCount: 2,
          imageCount: 0,
        }],
      },
    });

    expect(context.markdown).toContain("本地视觉前缀");
    expect(context.markdown).toContain("本地导演规划规则");
    expect(context.markdown).not.toContain("三族灵气");
  });

  it("groups storyboards into Toonflow-style production tracks", () => {
    const storyboards: StoryboardItem[] = [
      storyboard("sb-2", 2, "opening", 4),
      storyboard("sb-1", 1, "opening", 3),
      storyboard("sb-3", 3, "market", 5),
    ];

    const tracks = groupStoryboardsIntoTracks(storyboards);

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      storyboardIds: ["sb-1", "sb-2"],
      duration: 7,
      state: "idle",
    });
    expect(tracks[1]?.storyboardIds).toEqual(["sb-3"]);
  });

  it("validates structured relay and model binding config without executing vendor code", () => {
    const vendor: VendorConfig = {
      id: "relay-openai",
      name: "OpenAI 兼容中转站",
      enabled: true,
      relayBaseUrl: "https://relay.example.com/v1",
      inputValues: { apiKey: "sk-test" },
      models: [
        {
          id: "relay-openai:video-local-placeholder",
          name: "视频占位模型",
          type: "video",
          capabilities: { imageReference: 1, audioReference: 1, durations: [5, 10], resolutions: ["1080p"] },
          defaultParams: { resolution: "1080p" },
        },
      ],
    };

    const validated = validateVendorConfig(vendor);
    const binding = resolveModelBinding(
      [{ key: "videoTrack", modelId: "relay-openai:video-local-placeholder" }],
      [validated],
      "videoTrack",
    );

    expect(validated.relayBaseUrl).toBe("https://relay.example.com/v1");
    expect(binding?.model.type).toBe("video");
  });

  it("rejects invalid model capability types in structured config", () => {
    expect(() => validateVendorConfig({
      id: "relay",
      name: "Relay",
      enabled: true,
      inputValues: {},
      models: [
        {
          id: "relay:unknown",
          name: "Unknown",
          type: "unknown" as never,
          capabilities: {},
          defaultParams: {},
        },
      ],
    })).toThrow("模型类型无效");
  });

  it("creates local ffmpeg render plans for track candidates and final episode merge", () => {
    const track = groupStoryboardsIntoTracks([
      {
        ...storyboard("sb-1", 1, "opening", 3),
        mediaRef: { kind: "image", path: "/tmp/opening.png" },
        videoDesc: "王离：账本少了一页",
      },
    ])[0]!;

    const candidatePlan = createTrackRenderPlan(track, [
      {
        ...storyboard("sb-1", 1, "opening", 3),
        mediaRef: { kind: "image", path: "/tmp/opening.png" },
        videoDesc: "王离：账本少了一页",
      },
    ]);
    const mergePlan = createEpisodeMergePlan([
      { id: "video-1", trackId: track.id, provider: "ffmpeg-local", state: "ready", filePath: "/tmp/opening.mp4", createdAt: 1 },
    ]);

    expect(candidatePlan.kind).toBe("track-candidate");
    expect(candidatePlan.inputs[0]?.sourcePath).toBe("/tmp/opening.png");
    expect(candidatePlan.subtitleText).toBe("账本少了一页");
    expect(mergePlan.inputs).toEqual(["/tmp/opening.mp4"]);
  });

  it("does not treat audio-only materials as visual ffmpeg track inputs", () => {
    const track = groupStoryboardsIntoTracks([
      {
        ...storyboard("sb-audio", 1, "opening", 3),
        mediaRef: { kind: "audio", path: "/tmp/voice.wav" },
      },
    ])[0]!;

    expect(() => createTrackRenderPlan(track, [
      {
        ...storyboard("sb-audio", 1, "opening", 3),
        mediaRef: { kind: "audio", path: "/tmp/voice.wav" },
      },
    ])).toThrow("没有可用于本地合成的分镜素材");
  });

  it("normalizes imported local materials into storyboard media refs", () => {
    const image = createMaterialRecord({
      name: "Opening Frame.PNG",
      localPath: "local-image://studio-assets/opening.png",
      size: 1024,
      importedAt: 1710000000000,
    });
    const video = createMaterialRecord({
      name: "take.mov",
      localPath: "local-image://studio-assets/take.mov",
      size: 4096,
      importedAt: 1710000000000,
    });

    expect(inferMaterialKind("voice.wav")).toBe("audio");
    expect(image).toMatchObject({
      id: "material-1710000000000-opening-frame-png",
      kind: "image",
      sourceName: "Opening Frame.PNG",
    });
    expect(buildMediaRefFromMaterial(video)).toEqual({
      kind: "video",
      path: "local-image://studio-assets/take.mov",
    });
  });
});

function storyboard(id: string, index: number, trackKey: string, duration: number): StoryboardItem {
  return {
    id,
    episodeId: "episode-1",
    index,
    trackKey,
    trackId: "",
    duration,
    prompt: `${trackKey} prompt`,
    videoDesc: "",
    assetIds: [],
    state: "idle",
  };
}
