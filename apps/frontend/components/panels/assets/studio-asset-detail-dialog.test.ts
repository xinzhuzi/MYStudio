import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAssetRegenerationPrompt,
  getAssetDisplayName,
  getAssetSpokenText,
  persistGeneratedAssetPromptToLibrary,
  saveGeneratedAssetImageToLibrary,
  updateImagesAfterReplacingMainImage,
} from "./StudioAssetDetailDialog";
import type { StudioAssetSummary } from "@/types/studio-assets";

describe("buildAssetRegenerationPrompt", () => {
  afterEach(() => {
    delete (globalThis as any).window;
    vi.restoreAllMocks();
  });

  it("combines prompt, setting, and description for regenerating an asset image", () => {
    const asset: StudioAssetSummary = {
      id: "asset-1",
      source: "toonflow-runtime",
      type: "role",
      name: "主角",
      prompt: "水墨修仙少年，玄色长衣",
      setting: "道劫主角，三族灵气缠身",
      description: "冷峻、克制、背负旧债",
    };

    expect(buildAssetRegenerationPrompt(asset)).toBe([
      "水墨修仙少年，玄色长衣",
      "道劫主角，三族灵气缠身",
      "冷峻、克制、背负旧债",
    ].join("\n\n"));
  });

  it("skips empty fields instead of inserting blank sections", () => {
    const asset: StudioAssetSummary = {
      id: "asset-2",
      source: "manying-local",
      type: "scene",
      name: "山门",
      setting: "云雾山门，残碑与剑痕",
    };

    expect(buildAssetRegenerationPrompt(asset)).toBe("云雾山门，残碑与剑痕");
  });

  it("uses the audio file name as a clean visible title", () => {
    const asset: StudioAssetSummary = {
      id: "asset-audio-1",
      source: "manying-local",
      type: "audio",
      name: "/Users/zhengbingjin/Documents/音频/800+音色合集/少年旁白_穿过雨夜.wav",
      filePath: "/project/assets/audio/少年旁白_穿过雨夜.wav",
    };

    expect(getAssetDisplayName(asset)).toBe("少年旁白_穿过雨夜");
    expect(getAssetSpokenText(asset)).toBe("少年旁白 穿过雨夜");
  });

  it("uses semicolon-separated names as primary and secondary asset names", () => {
    const asset: StudioAssetSummary = {
      id: "asset-tool-1",
      source: "manying-local",
      type: "tool",
      name: "铜钱;铜币;古钱",
    };

    expect(getAssetDisplayName(asset)).toBe("铜钱");
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("secondaryNames");
    expect(source).toContain("副名字");
  });

  it("keeps a real spoken description ahead of the file path", () => {
    const asset: StudioAssetSummary = {
      id: "asset-audio-2",
      source: "manying-local",
      type: "audio",
      name: "女声试音.mp3",
      description: "你终于回来了，风雪已经等了你三年。",
    };

    expect(getAssetSpokenText(asset)).toBe("你终于回来了，风雪已经等了你三年。");
  });

  it("loads full asset data from an effect instead of mutating state during render", () => {
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("if (asset && asset.id !== prevAssetId.current)");
    expect(source).toContain("useEffect(() =>");
  });

  it("opens the reusable voice assignment dialog from role details", () => {
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";');
    expect(source).toContain("setVoiceAssignOpen(true)");
    expect(source).toContain("<RoleVoiceAssignDialog");
    expect(source).not.toContain("请在「剧情产物生成」中为该角色分配音色");
  });

  it("keeps workflow generation free of the role voice assignment editor", () => {
    const source = readFileSync(new URL("../studio/index.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("function VoiceAssignDialog(");
    expect(source).not.toContain("<RoleVoiceAssignDialog");
    expect(source).not.toContain('import { RoleVoiceAssignDialog } from "@/components/panels/assets/RoleVoiceAssignDialog";');
  });

  it("syncs the active project before binding a role voice", () => {
    const source = readFileSync(new URL("./RoleVoiceAssignDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { useProjectStore } from "@/stores/project-store";');
    expect(source).toContain("setTtsActiveProjectId(activeProjectId)");
    expect(source).toContain("ensureTtsProject(activeProjectId)");
  });

  it("lets role voice assignment search audio assets before selection", () => {
    const source = readFileSync(new URL("./RoleVoiceAssignDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("audioSearch");
    expect(source).toContain("filteredAudioAssets");
    expect(source).toContain('placeholder="搜索音频名称或文件名"');
    expect(source).toContain("filteredAudioAssets.map");
  });

  it("keeps reference text when binding an asset audio as a cloned role voice", () => {
    const source = readFileSync(new URL("./RoleVoiceAssignDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("referenceText: selectedAsset.referenceText");
    expect(source).toContain("buildRoleVoicePreviewInstruction(character)");
  });

  it("uses normal Chinese audition text and blocks qwen previews without reference text", () => {
    const source = readFileSync(new URL("./RoleVoicePreviewButton.tsx", import.meta.url), "utf8");
    expect(source).toContain('from "@/lib/tts/voice-preview-text"');
    expect(source).toContain("recoverVoiceProfileReferenceText");
    expect(source).toContain("getVoicePreviewBlockReason(previewProfile)");
    expect(source).toContain("buildRoleVoicePreviewText(characterName)");
    expect(source).not.toContain("大家好，我是${characterName}，很高兴认识你们。");
  });

  it("reuses the shared role voice preview button instead of owning a duplicate chain", () => {
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";');
    expect(source).toContain('from "@/lib/tts/role-speaker-id"');
    expect(source).toContain("toRoleSpeakerId(asset.id)");
    expect(source).not.toContain("function RoleVoicePreviewButton(");
  });

  it("writes one-click generated images and prompts back to the studio asset library", async () => {
    const replaceImage = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    const update = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    const getAbsolutePath = vi.fn().mockResolvedValue("/tmp/generated-role.png");
    (globalThis as any).window = {
      studioAssets: {
        replaceImage,
        update,
      },
      imageStorage: {
        getAbsolutePath,
      },
    };

    const saved = await saveGeneratedAssetImageToLibrary(
      "asset-role-1",
      "local-image://characters/generated-role.png",
      {
        status: "success",
        prompt: "polished role image prompt",
        negativePrompt: "avoid blurry",
      },
    );

    expect(saved).toBe(true);
    expect(getAbsolutePath).toHaveBeenCalledWith("local-image://characters/generated-role.png");
    expect(replaceImage).toHaveBeenCalledWith({
      assetId: "asset-role-1",
      sourceFilePath: "/tmp/generated-role.png",
    });
    expect(update).toHaveBeenCalledWith({
      id: "asset-role-1",
      updates: { prompt: "polished role image prompt" },
    });
  });

  it("uses the absolute saved file path when writing generated data-url images back to the asset library", async () => {
    const replaceImage = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    const saveMaterial = vi.fn().mockResolvedValue({
      success: true,
      localPath: "local-image://studio-assets/generated-role.png",
      filePath: "/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/generated-role.png",
    });
    const update = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["image-bytes"], { type: "image/png" }))));
    (globalThis as any).window = {
      studioAssets: {
        saveMaterial,
        replaceImage,
        update,
      },
    };

    const saved = await saveGeneratedAssetImageToLibrary(
      "asset-role-1",
      "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
      {
        status: "success",
        prompt: "polished role image prompt",
        negativePrompt: "avoid blurry",
      },
    );

    expect(saved).toBe(true);
    expect(replaceImage).toHaveBeenCalledWith({
      assetId: "asset-role-1",
      sourceFilePath: "/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/generated-role.png",
    });
  });

  it("persists one-click generated prompts before image saving succeeds", async () => {
    const update = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    (globalThis as any).window = {
      studioAssets: {
        update,
      },
    };

    const saved = await persistGeneratedAssetPromptToLibrary("asset-role-1", {
      status: "success",
      prompt: "polished role prompt from one-click generation",
      negativePrompt: "avoid blurry",
    });

    expect(saved).toBe(true);
    expect(update).toHaveBeenCalledWith({
      id: "asset-role-1",
      updates: { prompt: "polished role prompt from one-click generation" },
    });
  });

  it("inserts a main image after replacing an asset that had no preview", () => {
    const nextImages = updateImagesAfterReplacingMainImage([], {
      id: "asset-role-1",
      source: "manying-local",
      type: "role",
      name: "老苦力",
      filePath: "role/老苦力.png",
      previewUrl: "file:///asset-files/role/老苦力.png",
      thumbnailUrl: "file:///asset-thumbs/role/老苦力.png",
    });

    expect(nextImages).toEqual([
      {
        name: "主图",
        filePath: "role/老苦力.png",
        url: "file:///asset-files/role/老苦力.png",
      },
    ]);
  });

  it("keeps one-click asset image generation from repolishing existing prompts while generating missing prompts", () => {
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("const shouldGeneratePrompt = !existingPrompt");
    expect(source).toContain("skipPolish: !shouldGeneratePrompt");
    expect(source).toContain("existingPrompt");
    expect(source).toContain("正在根据风格生成 ${asset.name} 的出图提示词");
    expect(source).toContain("生成提示词中...");
  });

  it("keeps one-click asset image generation with the prompt actions instead of the empty-data notice", () => {
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("handleOneClickGenerateAssetImage");
    expect(source).toContain("一键生成资产生图");
    expect(source).not.toContain("点击下方按钮将走完整生成流程");
  });
});
