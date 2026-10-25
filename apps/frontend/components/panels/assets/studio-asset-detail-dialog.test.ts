import { existsSync, readFileSync } from "node:fs";
const readDialogSources = () =>
  readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8")
  + readFileSync(new URL("./studio-asset-detail-actions.ts", import.meta.url), "utf8");

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAssetRegenerationPrompt,
  getAssetDisplayName,
  getAssetImageOpenTarget,
  getAssetOperationError,
  getAssetSpokenText,
  persistGeneratedAssetPromptToLibrary,
  resolveAssetGenerationReferenceImage,
  resolveThreeTrackAssetType,
  saveGeneratedAssetImageToLibrary,
  updateImagesAfterReplacingMainImage,
} from "./StudioAssetDetailDialog";
import {
  persistGeneratedAssetPromptToLibrary as canonicalPersistGeneratedAssetPromptToLibrary,
  saveGeneratedAssetImageToLibrary as canonicalSaveGeneratedAssetImageToLibrary,
} from "./studio-asset-generation-persistence";
import type { StudioAssetSummary } from "@/types/studio-assets";

/** 门禁例外段配套(10-24 批2):window 补桩走类型化助手(裸 any 断言禁入 lint 例外段)。 */
function stubTestWindow(value: unknown): void {
  (globalThis as { window?: unknown }).window = value;
}

function unstubTestWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

describe("buildAssetRegenerationPrompt", () => {
  afterEach(() => {
    unstubTestWindow();
    vi.restoreAllMocks();
  });

  it("normalizes rejected asset operations into user-facing errors", () => {
    expect(getAssetOperationError(new Error("IPC unavailable"), "保存失败")).toBe("保存失败: IPC unavailable");
    expect(getAssetOperationError("unexpected", "加载资产详情失败")).toBe("加载资产详情失败");
    expect(getAssetOperationError(new Error("   "), "删除失败")).toBe("删除失败");
  });

  it("keeps generated asset persistence behind the dialog compatibility facade", () => {
    expect(persistGeneratedAssetPromptToLibrary).toBe(
      canonicalPersistGeneratedAssetPromptToLibrary,
    );
    expect(saveGeneratedAssetImageToLibrary).toBe(
      canonicalSaveGeneratedAssetImageToLibrary,
    );
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
      name: "/tmp/mystudio-fixtures/音频/800+音色合集/少年旁白_穿过雨夜.wav",
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
    const source = readDialogSources();
    expect(source).toContain("secondaryNames");
    expect(source).toContain("副名字");
  });

  it("opens the image currently selected in the asset carousel by disk path (10-19 报障修复:filePath 优先)", () => {
    const asset: StudioAssetSummary = {
      id: "asset-role-3",
      source: "manying-local",
      type: "role",
      name: "主角",
      sourcePath: "/asset-files/role/main.png",
      filePath: "role/main.png",
    };
    const images = [
      { name: "老苦力", filePath: "role/main.png", url: "file:///asset-files/role/main.png" },
      { name: "姿态一", filePath: "role/pose-one.png", url: "file:///asset-files/role/pose-one.png" },
    ];

    // 优先级①:当前图 filePath(磁盘路径;协议头 url 不再当选)
    expect(getAssetImageOpenTarget(images, 0, asset)).toBe("role/main.png");
    expect(getAssetImageOpenTarget(images, 1, asset)).toBe("role/pose-one.png");
    // 优先级②③:条目无 filePath → 资产 sourcePath → 资产 filePath
    const urlOnlyImages = [
      { name: "老苦力", filePath: "", url: "asset-file://role/main.png" },
    ];
    expect(getAssetImageOpenTarget(urlOnlyImages, 0, asset)).toBe("/asset-files/role/main.png");
    expect(getAssetImageOpenTarget(urlOnlyImages, 0, { ...asset, sourcePath: undefined })).toBe("role/main.png");
    // 末位兜底:无任何 filePath 时,url 仅当形如磁盘路径(以 / 开头)才可用;
    // 协议头 url 一律空串(走「没有可打开的本地路径」toast)
    const bare: StudioAssetSummary = { id: "x", source: "manying-local", type: "role", name: "裸" };
    expect(getAssetImageOpenTarget([{ name: "a", filePath: "", url: "/abs/path.png" }], 0, bare)).toBe("/abs/path.png");
    expect(getAssetImageOpenTarget(urlOnlyImages, 0, bare)).toBe("");
    expect(getAssetImageOpenTarget([], 0, bare)).toBe("");
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
    const source = readDialogSources();
    expect(source).not.toContain("if (asset && asset.id !== prevAssetId.current)");
    expect(source).toContain("useEffect(() =>");
  });

  it("routes asset IPC through the renderer bridge adapter", () => {
    const source = readDialogSources();
    expect(source).toContain('from "@/lib/bridge/studio-assets"');
    expect(source).toContain("getStudioAssetsBridge");
    expect(source).not.toContain("window.studioAssets");
  });

  it("routes asset library IPC through the renderer bridge adapter", () => {
    const source = readFileSync(new URL("./StudioAssetLibrary.tsx", import.meta.url), "utf8");
    expect(source).toContain('from "@/lib/bridge/studio-assets"');
    expect(source).toContain("getStudioAssetsBridge");
    expect(source).not.toContain("window.studioAssets");
  });

  it("routes asset creation and role voice asset reads through the renderer bridge adapter", () => {
    const addAssetSource = readFileSync(new URL("./AddAssetDialog.tsx", import.meta.url), "utf8");
    const roleVoiceSource = readFileSync(new URL("./RoleVoiceAssignDialog.tsx", import.meta.url), "utf8");

    expect(addAssetSource).toContain('import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";');
    expect(addAssetSource).toContain("getStudioAssetsBridge()");
    expect(addAssetSource).not.toContain("window.studioAssets");
    expect(roleVoiceSource).toContain('import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";');
    expect(roleVoiceSource).toContain("getStudioAssetsBridge()");
    expect(roleVoiceSource).not.toContain("window.studioAssets");
  });

  it("opens the reusable voice assignment dialog from role details", () => {
    const source = readDialogSources();
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
    expect(source).toContain('import { useProjectStore } from "@/stores/project/project-store";');
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
    const source = readDialogSources();
    expect(source).toContain('import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";');
    expect(source).toContain('from "@/lib/tts/role-speaker-id"');
    expect(source).toContain("toRoleSpeakerId(asset.id)");
    expect(source).not.toContain("function RoleVoicePreviewButton(");
  });

  it("delegates role attribute parsing and rendering to the focused leaf", () => {
    const source = readDialogSources();

    expect(source).toContain(
      'import { StudioAssetRoleAttributes } from "./studio-asset-role-attributes";',
    );
    expect(source).toContain(
      '<StudioAssetRoleAttributes setting={draftSetting || asset.setting || ""} />',
    );
    expect(source).not.toContain("const fields: { label: string; value: string }[] = [];");
  });

  it("writes one-click generated images and prompts back to the studio asset library", async () => {
    const replaceImage = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    const update = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    const getAbsolutePath = vi.fn().mockResolvedValue("/tmp/generated-role.png");
    stubTestWindow({
      studioAssets: {
        replaceImage,
        update,
      },
      imageStorage: {
        getAbsolutePath,
      },
    });

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
      filePath: "/tmp/mystudio-storage/assets/files/generated-role.png",
    });
    const update = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["image-bytes"], { type: "image/png" }))));
    stubTestWindow({
      studioAssets: {
        saveMaterial,
        replaceImage,
        update,
      },
    });

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
      sourceFilePath: "/tmp/mystudio-storage/assets/files/generated-role.png",
    });
  });

  it("persists one-click generated prompts before image saving succeeds", async () => {
    const update = vi.fn().mockResolvedValue({ id: "asset-role-1" });
    stubTestWindow({
      studioAssets: {
        update,
      },
    });

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
        name: "老苦力",
        filePath: "role/老苦力.png",
        url: "file:///asset-files/role/老苦力.png",
      },
    ]);
  });

  it("keeps one-click asset image generation from repolishing existing prompts while generating missing prompts", () => {
    const source = readDialogSources();
    expect(source).toContain("const shouldGeneratePrompt = !existingPrompt");
    expect(source).toContain("skipPolish: !shouldGeneratePrompt");
    expect(source).toContain("existingPrompt");
    expect(source).toContain("正在根据风格生成 ${asset.name} 的出图提示词");
    expect(source).toContain("生成提示词中...");
  });

  it("keeps one-click asset image generation with the prompt actions instead of the empty-data notice", () => {
    const source = readDialogSources();
    expect(source).toContain("handleOneClickGenerateAssetImage");
    expect(source).toContain("一键生成资产生图");
    expect(source).not.toContain("点击下方按钮将走完整生成流程");
  });

  it("uses the multi-select bridge for detail-image additions and keeps the selected-image semantics", () => {
    const source = readDialogSources();
    const previewSource = readFileSync(new URL("./studio-asset-detail-preview-pane.tsx", import.meta.url), "utf8");
    expect(source).toContain("selectImageFiles");
    expect(source).toContain("for (const filePath of filePaths)");
    expect(source).toContain("onSelectImage={setCurrentIndex}");
    expect(previewSource).toContain("onSelectImage(index)");
    expect(source).toContain("getAssetImageOpenTarget(carouselImages, currentIndex, detail)");
  });
});

describe("10-24 布局重造批1(竖滑单列+元信息置顶+轮播拆除)", () => {
  const readPaneSource = () => readFileSync(new URL("./studio-asset-detail-preview-pane.tsx", import.meta.url), "utf8");

  it("壳不变(92vh×90vw+overflow-hidden)+双栏拆除为竖向单列滚动", () => {
    const source = readDialogSources();
    expect(source).toContain("h-[92vh] w-[90vw]! max-w-[90vw]! overflow-hidden bg-card/50 p-0");
    expect(source).not.toContain("grid-cols-[minmax(280px,420px)_1fr]");
    expect(source).toContain("studio-asset-meta-region");
  });

  it("元信息区四行网格置顶+保存/删除在行尾,可折叠+态记忆(localStorage)", () => {
    const source = readDialogSources();
    expect(source).toContain('const META_COLLAPSED_STORAGE_KEY = "asset-dialog-meta-collapsed"');
    expect(source).toContain("setMetaCollapsed((collapsed) => !collapsed)");
    expect(source).toContain("grid grid-cols-2 gap-3");
    // 行1 名字|描述,行2 角色属性|音色(仅role),行3 提示词|设定,行尾 保存|删除
    expect(source).toContain('<StudioAssetRoleAttributes setting={draftSetting || asset.setting || ""} />');
    expect(source).toContain("一键生成资产生图");
    expect(source).toContain("润色提示词");
    // 折叠留摘要(资产名+别名数)+保存/删除
    expect(source).toContain("别名 {parsedDraftName.secondaryNames.length}");
    // #14/#15 保存/删除两态可达(折叠摘要行+展开行尾)
    expect(source.match(/onClick=\{handleSave\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/onClick=\{handleDelete\}/g)?.length).toBeGreaterThanOrEqual(2);
    // 第20交互(19 项清单补录):提示词区独立「复制」钮直连 clipboard,不经 onCopyPrompt
    expect(source).toContain("navigator.clipboard.writeText(draftPrompt)");
    expect(source).toContain("disabled={!draftPrompt}");
  });

  it("轮播拆除:无 Carousel 依赖,currentIndex 语义迁移为全局单选图(订阅链退役)", () => {
    const source = readDialogSources();
    const previewSource = readPaneSource();
    expect(source).not.toContain("CarouselApi");
    expect(source).not.toContain("subscribeAssetCarouselIndex");
    expect(previewSource).not.toContain('from "@/components/ui/carousel"');
    expect(previewSource).not.toContain("CarouselItem");
    expect(source).toContain("onSelectImage={setCurrentIndex}");
    // 订阅模块随轮播退役
    expect(existsSync(new URL("./studio-asset-detail-carousel.ts", import.meta.url))).toBe(false);
    // 删图夹回/家族行过滤(removedFamilyPaths)随单选图语义保留
    expect(source).toContain("setRemovedFamilyPaths((prev) => [...prev, image.filePath]");
    expect(source).toContain("Math.min(cur, Math.max(displayImages.length - 2, 0))");
    // 完成切新图/删图夹回仍走 setCurrentIndex(actions 尾段零动)
    expect(source).toContain("setCurrentIndex(0)");
  });

  it("图片规范区骨架:三轨型节+占位卡+完整度条占位+clip 单节+audio 零动在 pane 落位", () => {
    const previewSource = readPaneSource();
    // Round 3 ⑤:型节定义从 role 专属常量改轨道谱装配(TYPED_SECTION_DEFS=按谱派生)
    expect(previewSource).toContain("TYPED_SECTION_DEFS");
    expect(previewSource).toContain("getAssetImageKindSpectrum");
    expect(previewSource).toContain("早期未分类");
    expect(previewSource).toContain("studio-asset-image-placeholder");
    expect(previewSource).toContain("studio-asset-completeness-bar");
    expect(previewSource).toContain("overflow-x-auto");
    expect(previewSource).toContain('const SINGLE_SECTION_TITLE = "图片"');
    // audio 轨零动:播报卡/波形/转写链路保持
    expect(previewSource).toContain("智能生成说话内容");
    expect(previewSource).toContain("studio-audio-waveform");
  });

  it("批2 分类归节装配方+批3 全型路由:onGenerateByKind(人脸双择路/表情差分既有路/余型走 handleTypeShot)", () => {
    const dialogSource = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(dialogSource).toContain("onGenerateByKind=");
    expect(dialogSource).toContain('kind === "高清人脸"');
    expect(dialogSource).toContain("handleFacePortraitFromImage");
    expect(dialogSource).toContain("handleFacePortraitFromText");
    expect(dialogSource).toContain('kind === "表情差分"');
    expect(dialogSource).toContain("handleExpressionSheet");
    // 批3:余型收尾派发到型驱动件(占位卡 CTA/缺失 chip 直达全型可达)
    expect(dialogSource).toContain("handleTypeShot(kind)");
    // 生成写路 kind 落值(视图模型层;行级主图持久化候 Round 3 Q2;批3 型驱动件按型名落值)
    const actionsSource = readFileSync(new URL("./studio-asset-detail-actions.ts", import.meta.url), "utf8");
    expect(actionsSource).toContain('kind: "高清人脸"');
    expect(actionsSource).toContain('kind: "表情差分"');
    expect(actionsSource).toContain("url: updated.previewUrl || updated.thumbnailUrl, kind }");
    expect(actionsSource).toContain("classifyAssetImage");
  });

  it("批2 B 节:放大钮预览序列=当前节图集(节内上下张),url 序与 initialIndex 同构产出", () => {
    const dialogSource = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(dialogSource).toContain("classifyAssetImage(displayImages[clickedIndex])");
    expect(dialogSource).toContain("sectionLocalIndex");
    // 旧全局序+filter(Boolean) 错位链退役
    expect(dialogSource).not.toContain('imageUrls={displayImages.map((img) => img.url ?? "").filter(Boolean)}');
  });

  it("悬空重命名死代码清理(重命名不在 19 项保全清单;桥 renameImage 本体未动)", () => {
    const actionsSource = readFileSync(new URL("./studio-asset-detail-actions.ts", import.meta.url), "utf8");
    expect(actionsSource).not.toContain("renameImage");
  });
});

describe("10-24 批3(按型出图按钮族:typeShot 第五路+全型路由+一键补缺队列)", () => {
  const readActionsSource = () => readFileSync(new URL("./studio-asset-detail-actions.ts", import.meta.url), "utf8");

  it("弹窗装配 typeShotPhase/typeShotMessage 状态并接线 pane(节头钮/下拉/补缺队列)", () => {
    const source = readDialogSources();
    expect(source).toContain("const [typeShotPhase, setTypeShotPhase]");
    expect(source).toContain("const [typeShotMessage, setTypeShotMessage]");
    expect(source).toContain("canTypeShot={canTypeShot}");
    expect(source).toContain("onTypeShot={handleTypeShot}");
    expect(source).toContain("typeShotPhase={typeShotPhase}");
    expect(source).toContain("typeShotMessage={typeShotMessage}");
    expect(source).toContain("onFillMissing={handleFillMissingQueue}");
    // Round 3 扩展令⑤:按型出图族从 role 专属推广图片三轨(isThreeTrackAsset=role/scene/tool)
    expect(source).toContain("const canTypeShot = isThreeTrackAsset;");
  });

  it("runTypeShot 走型驱动 service+命名=原图名_{型名}_中文日期+批3 kind 落值", () => {
    const source = readActionsSource();
    expect(source).toContain('from "@/lib/studio/asset-type-shot"');
    expect(source).toContain("generateAssetTypeShot");
    expect(source).toContain("getAssetTypeShotProfile");
    // 命名令:i2i=原图名_{型名}_中文日期;t2i=资产名_{型名}_中文日期(型名插中间段)
    expect(source).toContain("`${inputImageName}_${kind}_${dateSuffix}`");
    // 写路 kind 落值:按型出图产物型名即所属节(批3 视图值)
    expect(source).toContain("url: updated.previewUrl || updated.thumbnailUrl, kind }");
  });

  it("Round 3 ⑤ 三轨推广装配方:型谱归属守卫+track 透传 service+补缺队列按轨取谱", () => {
    const source = readActionsSource();
    // 三轨收敛(clip/audio 拒收)与型谱归属守卫(跨轨型名拒收)
    expect(source).toContain("asAssetImageTrack(asset.type)");
    expect(source).toContain("getAssetImageKindSpectrum(track).order.includes(kind)");
    expect(source).toContain("按型出图仅角色/场景/道具三轨资产可用");
    // track 随任务透传(service 按轨分流落盘 scene/prop + 写回)
    expect(source).toContain("kind,\n          track,");
    // 补缺队列按轨取谱(role 谱行为零变化;tool 轨 t2i 零图可补)
    expect(source).toContain("planAssetTypeFillMissingQueue(images, track)");
    expect(source).toContain("needsReference && carouselImages.length === 0");
  });

  it("一键补缺顺序队列:plan 计划+逐型派发路由(人脸/表情差分接既有路,余型 executeTypeShot)+失败即停", () => {
    const source = readActionsSource();
    expect(source).toContain("planAssetTypeFillMissingQueue");
    expect(source).toContain("runFillMissingQueue");
    // 复审H修:队列派发带 laneGuard:false(队列入口自持五路守卫,底层免闸防自拒)
    expect(source).toContain('if (kind === "高清人脸") return runFacePortrait(');
    expect(source).toContain('if (kind === "表情差分") return runExpressionSheet({ laneGuard: false })');
    expect(source).toContain("executeTypeShot(kind, { managedLane: false })");
    // 队列复用 typeShot 聚合相位(进度文案逐型推进);失败中止文案在场
    expect(source).toContain("正在补缺 ${completed + 1}/${missing.length}:${kind}...");
    expect(source).toContain("队列中止");
    // 互斥守卫:五路任一在跑拒入队
    expect(source).toContain("if (generatePhaseForGuard || i2iPhase || facePhase || expressionPhase || typeShotPhase)");
  });

  it("既有路返值化零行为变:人脸/表情差分按钮入口签名未动,仅内部 Promise<boolean> 供队列探成功", () => {
    const source = readActionsSource();
    expect(source).toContain('const handleFacePortraitFromImage = () => runFacePortrait("image")');
    expect(source).toContain('const handleFacePortraitFromText = () => runFacePortrait("text")');
    expect(source).toContain("const handleExpressionSheet = () => runExpressionSheet()");
    expect(source).toContain("const runFacePortrait = async (");
    expect(source).toContain("const runExpressionSheet = async (");
  });

  it("复审H修:五路互斥统一守卫——公共入口(runTypeShot/人脸/表情差分)任一相位在跑直返,队列 laneGuard:false 免闸复用底层", () => {
    const source = readActionsSource();
    // 统一守卫单源:五相位(generate/i2i/face/expression/typeShot)任一在跑即忙
    expect(source).toContain("const isAnyGenerationLaneBusy = (): boolean =>");
    expect(source).toContain("!!(generatePhaseForGuard || i2iPhase || facePhase || expressionPhase || typeShotPhase)");
    // runTypeShot 公共入口=全相位守卫(占位卡 CTA/缺失 chip/节头钮/下拉共用)
    expect(source).toContain("if (isAnyGenerationLaneBusy()) return false;");
    // 人脸/表情差分带 laneGuard 闸(缺省全相位,队列免闸防逐型派发自拒)
    expect(source).toContain("options?: { laneGuard?: boolean }");
    expect(source).toContain('runFacePortrait(carouselImages.length > 0 ? "image" : "text", { laneGuard: false })');
    expect(source).toContain("runExpressionSheet({ laneGuard: false })");
    // 直达入口的守卫留痕(与既有 busy 守卫同款日志链)
    expect(source).toContain("Asset face portrait guard rejected (busy-lane)");
    expect(source).toContain("Asset expression sheet guard rejected (busy-lane)");
  });

  it("复审M修:一键补缺计划按本行 images 计(族兄弟展示序不抵扣,Round 3 Q1);弹窗完整度基准=本行图集", () => {
    const source = readActionsSource();
    // Round 3 ⑤:按轨取谱(缺省 role 谱;plan 第二参=track)
    expect(source).toContain("planAssetTypeFillMissingQueue(images, track)");
    expect(source).not.toContain("planAssetTypeFillMissingQueue(carouselImages");
    const dialogSource = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(dialogSource).toContain("completenessImages={images}");
    const paneSource = readFileSync(new URL("./studio-asset-detail-preview-pane.tsx", import.meta.url), "utf8");
    expect(paneSource).toContain("completenessImages ?? images");
  });
});

describe("resolveAssetGenerationReferenceImage", () => {
  it("uses the currently viewed asset image as the regeneration reference", () => {
    const images = [{ url: "local-image://a.png" }, { url: "local-image://b.png" }];
    expect(resolveAssetGenerationReferenceImage(images, 1)).toBe("local-image://b.png");
    expect(resolveAssetGenerationReferenceImage(images, 0)).toBe("local-image://a.png");
  });

  it("falls back to the first image and returns undefined when the asset has none", () => {
    expect(resolveAssetGenerationReferenceImage([{ url: "local-image://a.png" }], 5)).toBe("local-image://a.png");
    expect(resolveAssetGenerationReferenceImage([], 0)).toBeUndefined();
    expect(resolveAssetGenerationReferenceImage([{}], 0)).toBeUndefined();
  });

  it("wires the reference into one-click asset generation", () => {
    const source = readDialogSources();
    expect(source).toContain("resolveAssetGenerationReferenceImage(carouselImages, currentIndex)");
    expect(source).toContain("referenceImages: referenceImage ? [referenceImage] : undefined");
  });
});

describe("resolveThreeTrackAssetType", () => {
  it("maps the three static image tracks exactly (role/scene/tool)", () => {
    expect(resolveThreeTrackAssetType("role")).toBe("character");
    expect(resolveThreeTrackAssetType("scene")).toBe("scene");
    expect(resolveThreeTrackAssetType("tool")).toBe("prop");
  });

  it.each(["clip", "audio", "任务", "", "unknown", null, undefined])(
    "rejects %j before any three-track generation entry",
    (input) => {
      expect(() => resolveThreeTrackAssetType(input as never)).toThrowError(
        expect.objectContaining({ code: "unsupported_asset_type" }),
      );
    },
  );

  it("keeps the detail dialog generation entries fail-closed for clip instead of silently reusing the prop track", () => {
    const source = readDialogSources();
    expect(source).toContain("resolveThreeTrackAssetType(asset.type)");
    expect(source).not.toContain('asset.type === "scene" ? "scene" as const : "prop" as const');
    expect(source).not.toContain(': "prop" as const\n        : "prop" as const');
  });
});

describe("R4 族聚显(10-19-script-asset-corridor-blank D1+D3:键=batchMatch 同源候选全集,序=updatedAt 倒序,族聚仅显示层)", () => {

  it("详情弹窗接受 familyImages 并以 mergeFamilyDisplayImages 派生轮播展示序", () => {
    const source = readDialogSources();
    expect(source).toContain("familyImages?: FamilyImageEntry[]");
    expect(source).toContain("mergeFamilyDisplayImages(familyImages, images, asset?.id)");
    expect(source).toContain("images={displayImages}");
  });

  it("轮播消费展示序:打开/参考图按 displayImages;增删仍只作用本行 images,跨行误删拒收", () => {
    const source = readDialogSources();
    expect(source).toContain("getAssetImageOpenTarget(carouselImages, currentIndex, detail)");
    expect(source).toContain("resolveAssetGenerationReferenceImage(carouselImages, currentIndex)");
    expect(source).toContain("const ownIndex = images.findIndex((item) => item.filePath === img.filePath)");
    expect(source).toContain("mergeFamilyDisplayImages(familyImages, newImgs, asset?.id)");
  });

  it("预览面板按条目 removable 控制删除可见性(10-19 追令:族兄弟图亦显示删除)", () => {
    const previewSource = readFileSync(new URL("./studio-asset-detail-preview-pane.tsx", import.meta.url), "utf8");
    expect(previewSource).toContain("isImageRemovable?: (image: AssetImage, index: number) => boolean");
    expect(previewSource).toContain("isImageRemovable(image, index)");
  });

  it("族兄弟删除落到其所属资产行(10-19 追令:可见即可删=删对行,不按当前行误删)", () => {
    const actionsSource = readFileSync(new URL("./studio-asset-detail-actions.ts", import.meta.url), "utf8");
    expect(actionsSource).toContain("entry.filePath === img.filePath && entry.assetId !== asset.id");
    expect(actionsSource).toContain("assetId: sibling.assetId");
    expect(actionsSource).toContain("已删除(该图属于");
  });

  it("删后即时刷新(10-19 用户报障):真删成功才本地过滤展示序+发 asset:updated", () => {
    const dialogSource = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(dialogSource).toContain("removedFamilyPaths");
    expect(dialogSource).toContain("setRemovedFamilyPaths((prev) => [...prev, image.filePath]");
    expect(dialogSource).toContain("const ok = await handleRemoveImage(image, index)");
    const actionsSource = readFileSync(new URL("./studio-asset-detail-actions.ts", import.meta.url), "utf8");
    expect(actionsSource).toContain("eventBus.emit(\"asset:updated\", { id: sibling.assetId");
    expect(actionsSource).toContain("eventBus.emit(\"asset:updated\", { id: asset.id");
  });

  it("剧本资产行打开详情即取族(键=行实体名,与本页 batchMatch 重识别同源),并透传弹窗", () => {
    const actionsSource = readFileSync(new URL("../studio/useScriptAssetGenerationActions.ts", import.meta.url), "utf8");
    expect(actionsSource).toContain(
      "fetchFamilyImageEntries(getStudioAssetsBridge(), toRuntimeAssetType(row.type), row.name)",
    );
    const tabSource = readFileSync(new URL("../studio/ScriptAssetGenerationTab.tsx", import.meta.url), "utf8");
    expect(tabSource).toContain("familyImages={selectedFamilyImages}");
  });
});

describe("图生图·画风转换(10-19-daojie-ui-i2i-style-convert:i2iPhase 状态装配+一键生成互斥+派发链)", () => {
  it("弹窗装配 i2iPhase/i2iMessage 状态并按三轨+有图推导 canImageToImage", () => {
    const source = readDialogSources();
    expect(source).toContain("const [i2iPhase, setI2iPhase]");
    expect(source).toContain("const [i2iMessage, setI2iMessage]");
    // 10-25 用户令:工具行移除,canImageToImage 派生与画风转换入口随之退役
    expect(source).not.toContain("const canImageToImage =");
  });

  it("预览面板接上派发与相位(i2iPhase/generatePhase/canImageToImage/onImageToImage)", () => {
    const source = readDialogSources();
    // 10-25 用户令:工具行移除,onImageToImage/canImageToImage 传参退役
    expect(source).not.toContain("onImageToImage={handleImageToImageStyle}");
    expect(source).toContain("i2iPhase={i2iPhase}");
    expect(source).toContain("generatePhase={generatePhase}");
  });

  it("一键生成按钮与图生图互斥(!!i2iPhase 禁用;批3 扩 typeShot 第五路)", () => {
    const source = readDialogSources();
    expect(source).toContain("disabled={!!generatePhase || !!i2iPhase || !!facePhase || !!expressionPhase || !!typeShotPhase || !visualManualId}");
  });

  it("handleImageToImageStyle 走画风转换 service 并复刻一键生成尾段(写回+广播+刷新+3s 自动清)", () => {
    const source = readDialogSources();
    // 守卫链:三轨 fail-closed + 轮播当前图作参考
    expect(source).toContain("handleImageToImageStyle");
    expect(source).toContain("generateAssetStyleTransferImage");
    expect(source).toContain("resolveAssetGenerationReferenceImage(carouselImages, currentIndex)");
    // 成功尾段镜像一键生成:写回资产库 + asset:updated 广播 + get 刷新轮播
    expect(source).toContain("saveGeneratedAssetImageToLibrary");
    expect(source).toContain('eventBus.emit("asset:updated"');
    expect(source).toContain('getStudioAssetsBridge()!.get(asset.id)');
    // 相位 3s 自动清
    expect(source).toMatch(/setI2iPhase\(null\)/);
  });

  it("handleImageToImageStyle 按本层惯例打点:operationId 自造贯通 service,守卫拒绝逐因留痕(10-19 用户令)", () => {
    const source = readDialogSources();
    expect(source).toContain('createOperationId("asset-style-transfer")');
    expect(source).toContain('operationId,');
    expect(source).toContain("Asset style transfer requested (image-to-image)");
    expect(source).toContain("Asset style transfer guard rejected (busy)");
    expect(source).toContain("Asset style transfer guard rejected (non-three-track)");
    expect(source).toContain("Asset style transfer guard rejected (no reference image)");
  });
});
