import type { SplitScene } from "@/stores/director/director-store";
import type { Character } from "@/stores/library/character-library-store";
import type { Scene } from "@/stores/library/scene-store";
import type { AssetRef, ShotGroup } from "@/stores/sclass/sclass-store";

export interface CollectedRefs {
  images: AssetRef[];
  videos: AssetRef[];
  audios: AssetRef[];
  totalFiles: number;
  overLimit: boolean;
  limitWarnings: string[];
}

export const SEEDANCE_LIMITS = {
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxTotalFiles: 12,
  maxPromptChars: 5000,
  maxDuration: 15,
  minDuration: 4,
} as const;

// ==================== Reference Collection ====================

/**
 * 从 character-library-store 提取角色参考图
 * 每个角色取第一张 view 图片
 */
export function collectCharacterRefs(
  characterIds: string[],
  characters: Character[],
): AssetRef[] {
  const refs: AssetRef[] = [];
  const seen = new Set<string>();

  for (const charId of characterIds) {
    if (seen.has(charId)) continue;
    seen.add(charId);

    const char = characters.find(c => c.id === charId);
    if (!char) continue;

    // 优先使用 base64（持久化），其次使用 URL
    const view = char.views[0];
    const imageUrl = view?.imageBase64 || view?.imageUrl || char.thumbnailUrl;
    if (!imageUrl) continue;

    refs.push({
      id: `char_${charId}`,
      type: 'image',
      tag: `@图片`,  // tag 会在最终组装时重新编号
      localUrl: imageUrl,
      httpUrl: null,
      fileName: `${char.name}_ref.png`,
      fileSize: 0,
      duration: null,
      purpose: 'character_ref',
    });
  }

  return refs;
}

/**
 * 从 scene-store 提取场景参考图
 * 通过 SplitScene.sceneLibraryId 关联
 */
export function collectSceneRefs(
  scenes: SplitScene[],
  sceneLibrary: Scene[],
): AssetRef[] {
  const refs: AssetRef[] = [];
  const seen = new Set<string>();

  for (const splitScene of scenes) {
    // 方式1: 直接使用分镜上已关联的场景参考图
    if (splitScene.sceneReferenceImage && !seen.has(splitScene.sceneReferenceImage)) {
      seen.add(splitScene.sceneReferenceImage);
      refs.push({
        id: `scene_ref_${splitScene.id}`,
        type: 'image',
        tag: '@图片',
        localUrl: splitScene.sceneReferenceImage,
        httpUrl: null,
        fileName: `scene_${splitScene.sceneName || splitScene.id}.png`,
        fileSize: 0,
        duration: null,
        purpose: 'scene_ref',
      });
      continue;
    }

    // 方式2: 通过 sceneLibraryId 从场景库查找
    if (splitScene.sceneLibraryId && !seen.has(splitScene.sceneLibraryId)) {
      seen.add(splitScene.sceneLibraryId);
      const sceneObj = sceneLibrary.find(s => s.id === splitScene.sceneLibraryId);
      const sceneImg = sceneObj?.referenceImageBase64 || sceneObj?.referenceImage;
      if (sceneImg) {
        refs.push({
          id: `scene_lib_${splitScene.sceneLibraryId}`,
          type: 'image',
          tag: '@图片',
          localUrl: sceneImg,
          httpUrl: null,
          fileName: `${sceneObj?.name || 'scene'}_ref.png`,
          fileSize: 0,
          duration: null,
          purpose: 'scene_ref',
        });
      }
    }
  }

  return refs;
}

/**
 * 收集组内各镜头的首帧图片作为 @Image
 */
export function collectFirstFrameRefs(scenes: SplitScene[]): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const scene of scenes) {
    const imageUrl = scene.imageDataUrl || scene.imageHttpUrl;
    if (!imageUrl) continue;
    refs.push({
      id: `firstframe_${scene.id}`,
      type: 'image',
      tag: '@图片',
      localUrl: imageUrl,
      httpUrl: scene.imageHttpUrl || null,
      fileName: `shot_${scene.id + 1}_frame.png`,
      fileSize: 0,
      duration: null,
      purpose: 'first_frame',
    });
  }
  return refs;
}

/**
 * 汇总所有 @引用并执行配额校验
 *
 * 新版优先级（格子图模式）：
 *   @Image1 = 格子图（1张） > @Image2~9 = 角色参考图（≤8张）
 * 旧版优先级（兼容）：
 *   首帧图 > 角色图 > 场景图，合计≤9张
 *
 * @param gridImageRef 如果提供，则使用格子图模式（不再逐张添加首帧）
 */
export function collectAllRefs(
  group: ShotGroup,
  scenes: SplitScene[],
  characters: Character[],
  sceneLibrary: Scene[],
  gridImageRef?: AssetRef | null,
): CollectedRefs {
  // 1. 收集角色参考图（去重：组内所有镜头的 characterIds 合并）
  const allCharIds = Array.from(
    new Set(scenes.flatMap(s => s.characterIds || []))
  );
  const charRefs = collectCharacterRefs(allCharIds, characters);

  // 2. 收集场景参考图
  const sceneRefs = collectSceneRefs(scenes, sceneLibrary);

  let images: AssetRef[];

  if (gridImageRef) {
    // ========== 格子图模式 ==========
    // 格子图占 1 槽，剩余给角色引用 + 场景参考图
    const remainingSlots = SEEDANCE_LIMITS.maxImages - 1;
    const charSlice = charRefs.slice(0, remainingSlots);
    images = [gridImageRef, ...charSlice];
    // 如果还有槽位，加入场景参考图
    const usedSlots = images.length;
    if (usedSlots < SEEDANCE_LIMITS.maxImages) {
      images.push(...sceneRefs.slice(0, SEEDANCE_LIMITS.maxImages - usedSlots));
    }
  } else {
    // ========== 旧版兼容模式：逐张首帧 > 角色 > 场景 ==========
    const frameRefs = collectFirstFrameRefs(scenes);
    const allImageRefs = [...frameRefs, ...charRefs, ...sceneRefs];
    images = allImageRefs.slice(0, SEEDANCE_LIMITS.maxImages);
  }

  // 5. 用户上传的视频/音频引用（已在 group 中）
  const videoSlice = (group.videoRefs || []).slice(0, SEEDANCE_LIMITS.maxVideos);
  const audioSlice = (group.audioRefs || []).slice(0, SEEDANCE_LIMITS.maxAudios);

  // 6. 重新编号 tag（map 创建新对象，消除副作用）
  const taggedImages = images.map((ref, i) => ({ ...ref, tag: `@图片${i + 1}` }));
  const taggedVideos = videoSlice.map((ref, i) => ({ ...ref, tag: `@视频${i + 1}` }));
  const taggedAudios = audioSlice.map((ref, i) => ({ ...ref, tag: `@音频${i + 1}` }));

  // 7. 配额校验
  const totalFiles = taggedImages.length + taggedVideos.length + taggedAudios.length;
  const warnings: string[] = [];
  if (taggedImages.length >= SEEDANCE_LIMITS.maxImages) {
    warnings.push(`图片引用已达上限 ${SEEDANCE_LIMITS.maxImages}`);
  }
  if (totalFiles > SEEDANCE_LIMITS.maxTotalFiles) {
    warnings.push(`总文件数 ${totalFiles} 超出限制 ${SEEDANCE_LIMITS.maxTotalFiles}`);
  }

  return {
    images: taggedImages,
    videos: taggedVideos,
    audios: taggedAudios,
    totalFiles,
    overLimit: totalFiles > SEEDANCE_LIMITS.maxTotalFiles,
    limitWarnings: warnings,
  };
}

