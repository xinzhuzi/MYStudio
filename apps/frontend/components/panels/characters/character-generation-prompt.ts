import { getStyleById } from "@/lib/constants/visual-styles";
import type {
  CharacterIdentityAnchors,
  PromptLanguage,
} from "@/types/script";

export const GENDER_PRESETS = [
  { id: "male", label: "男" },
  { id: "female", label: "女" },
  { id: "other", label: "其他" },
] as const;

export const AGE_PRESETS = [
  { id: "child", label: "儿童", range: "5-12岁" },
  { id: "teen", label: "青少年", range: "13-18岁" },
  { id: "young-adult", label: "青年", range: "19-30岁" },
  { id: "adult", label: "中年", range: "31-50岁" },
  { id: "senior", label: "老年", range: "50岁以上" },
] as const;

// Sheet elements
export const SHEET_ELEMENTS = [
  { id: 'three-view', label: '三视图', prompt: 'front view, side view, back view, turnaround', default: true },
  { id: 'expressions', label: '表情设定', prompt: 'expression sheet, multiple facial expressions, happy, sad, angry, surprised', default: true },
  { id: 'proportions', label: '比例设定', prompt: 'height chart, body proportions, head-to-body ratio reference', default: false },
  { id: 'poses', label: '动作设定', prompt: 'pose sheet, various action poses, standing, sitting, running', default: false },
] as const;

export type SheetElementId = typeof SHEET_ELEMENTS[number]['id'];


/**
 * 从6层身份锚点构建提示词
 * 
 * @param anchors - 6层身份锚点
 * @param hasReferenceImages - 是否有参考图
 * @returns 构建的提示词字符串
 * 
 * 参考图优先级逻辑：
 * - 有参考图时：只使用最强锚点（uniqueMarks + colorAnchors），其他特征由参考图引导
 * - 无参考图时：使用完整的6层特征锁定
 */
export function buildPromptFromAnchors(
  anchors: CharacterIdentityAnchors | undefined,
  hasReferenceImages: boolean,
  promptLanguage?: PromptLanguage
): string {
  if (!anchors) return '';

  // 根据锚点值内容自动检测语言（中文锚点值 → 中文连接词）
  const isZh = promptLanguage === 'zh' || /[\u4e00-\u9fff]/.test(anchors.faceShape || anchors.eyeShape || '');

  const parts: string[] = [];

  if (hasReferenceImages) {
    // === 有参考图：只使用最强锚点 ===
    if (anchors.uniqueMarks && anchors.uniqueMarks.length > 0) {
      parts.push(isZh ? `辨识标记：${anchors.uniqueMarks.join('、')}` : `distinctive marks: ${anchors.uniqueMarks.join(', ')}`);
    }

    if (anchors.colorAnchors) {
      const colors: string[] = [];
      if (anchors.colorAnchors.iris) colors.push(isZh ? `瞳色${anchors.colorAnchors.iris}` : `iris color ${anchors.colorAnchors.iris}`);
      if (anchors.colorAnchors.hair) colors.push(isZh ? `发色${anchors.colorAnchors.hair}` : `hair color ${anchors.colorAnchors.hair}`);
      if (anchors.colorAnchors.skin) colors.push(isZh ? `肤色${anchors.colorAnchors.skin}` : `skin tone ${anchors.colorAnchors.skin}`);
      if (colors.length > 0) {
        parts.push(colors.join(isZh ? '，' : ', '));
      }
    }
  } else {
    // === 无参考图：完整6层特征锁定 ===

    // ① 骨相层
    const boneFeatures: string[] = [];
    if (anchors.faceShape) boneFeatures.push(isZh ? `${anchors.faceShape}脸` : `${anchors.faceShape} face`);
    if (anchors.jawline) boneFeatures.push(isZh ? `${anchors.jawline}下颌` : `${anchors.jawline} jawline`);
    if (anchors.cheekbones) boneFeatures.push(isZh ? `${anchors.cheekbones}颧骨` : `${anchors.cheekbones} cheekbones`);
    if (boneFeatures.length > 0) {
      parts.push(boneFeatures.join(isZh ? '，' : ', '));
    }

    // ② 五官层
    const facialFeatures: string[] = [];
    if (anchors.eyeShape) facialFeatures.push(isZh ? `${anchors.eyeShape}眼` : `${anchors.eyeShape} eyes`);
    if (anchors.eyeDetails) facialFeatures.push(anchors.eyeDetails);
    if (anchors.noseShape) facialFeatures.push(anchors.noseShape);
    if (anchors.lipShape) facialFeatures.push(anchors.lipShape);
    if (facialFeatures.length > 0) {
      parts.push(facialFeatures.join(isZh ? '，' : ', '));
    }

    // ③ 辨识标记层
    if (anchors.uniqueMarks && anchors.uniqueMarks.length > 0) {
      parts.push(isZh ? `辨识标记：${anchors.uniqueMarks.join('、')}` : `distinctive marks: ${anchors.uniqueMarks.join(', ')}`);
    }

    // ④ 色彩锚点层
    if (anchors.colorAnchors) {
      const colors: string[] = [];
      if (anchors.colorAnchors.iris) colors.push(isZh ? `瞳色${anchors.colorAnchors.iris}` : `iris ${anchors.colorAnchors.iris}`);
      if (anchors.colorAnchors.hair) colors.push(isZh ? `发色${anchors.colorAnchors.hair}` : `hair ${anchors.colorAnchors.hair}`);
      if (anchors.colorAnchors.skin) colors.push(isZh ? `肤色${anchors.colorAnchors.skin}` : `skin ${anchors.colorAnchors.skin}`);
      if (anchors.colorAnchors.lips) colors.push(isZh ? `唇色${anchors.colorAnchors.lips}` : `lips ${anchors.colorAnchors.lips}`);
      if (colors.length > 0) {
        parts.push(isZh ? `色彩锚点：${colors.join('，')}` : `color anchors: ${colors.join(', ')}`);
      }
    }

    // ⑤ 皮肤纹理层
    if (anchors.skinTexture) {
      parts.push(isZh ? `皮肤纹理：${anchors.skinTexture}` : `skin texture: ${anchors.skinTexture}`);
    }

    // ⑥ 发型锚点层
    const hairFeatures: string[] = [];
    if (anchors.hairStyle) hairFeatures.push(anchors.hairStyle);
    if (anchors.hairlineDetails) hairFeatures.push(anchors.hairlineDetails);
    if (hairFeatures.length > 0) {
      parts.push(isZh ? `发型：${hairFeatures.join('，')}` : `hair: ${hairFeatures.join(', ')}`);
    }
  }

  return parts.join(isZh ? '，' : ', ');
}

/**
 * 构建角色设定图提示词
 * 
 * 优先级：
 * 1. 根据 promptLanguage 选择主提示词：zh→visualPromptZh, en→visualPromptEn, zh+en→两者合并
 * 2. 有参考图 + 有锚点：简化描述 + 最强锚点
 * 3. 无参考图 + 有锚点：完整6层锁定
 * 4. 有视觉提示词：使用AI大师生成的提示词
 * 5. 只有description：使用基础描述
 * 6. 年代信息：加入服装风格锚点
 */
export function buildCharacterSheetPrompt(
  description: string, 
  name: string, 
  selectedElements: SheetElementId[],
  styleId?: string,
  visualPromptEn?: string,
  visualPromptZh?: string,
  promptLanguage?: PromptLanguage,
  identityAnchors?: CharacterIdentityAnchors,
  hasReferenceImages?: boolean,
  storyYear?: number,
  era?: string
): string {
  const stylePreset = styleId && styleId !== 'random' 
    ? getStyleById(styleId) 
    : null;
  // 修复：自定义风格 prompt 为空时用风格名称兜底，而不是回退到 anime
  const styleTokens = stylePreset
    ? (stylePreset.prompt || `${stylePreset.name} style, professional quality`)
    : 'professional quality';
  const isRealistic = stylePreset?.category === 'real';
  
  // 根据语言偏好选择主视觉提示词
  const lang = promptLanguage || 'zh';

  // 构建年代服装提示词（根据语言偏好）
  let eraPrompt = '';
  if (storyYear) {
    if (lang === 'zh') {
      if (storyYear >= 2020) eraPrompt = `${storyYear}年代当代中国时尚，现代休闲风`;
      else if (storyYear >= 2010) eraPrompt = `${storyYear}年代中国时尚，韩风影响`;
      else if (storyYear >= 2000) eraPrompt = `2000年代初期中国时尚，千禧年服饰`;
      else if (storyYear >= 1990) eraPrompt = `1990年代中国时尚，转型期服饰`;
      else if (storyYear >= 1980) eraPrompt = `1980年代中国时尚，改革开放时期服饰`;
      else eraPrompt = `${storyYear}年代中国服饰风格`;
    } else {
      if (storyYear >= 2020) eraPrompt = `${storyYear}s contemporary Chinese fashion, modern casual style`;
      else if (storyYear >= 2010) eraPrompt = `${storyYear}s Chinese fashion, Korean-influenced style`;
      else if (storyYear >= 2000) eraPrompt = `early 2000s Chinese fashion, millennium era clothing style`;
      else if (storyYear >= 1990) eraPrompt = `1990s Chinese fashion, transitional era clothing`;
      else if (storyYear >= 1980) eraPrompt = `1980s Chinese fashion, reform era clothing style`;
      else eraPrompt = `${storyYear}s era-appropriate Chinese clothing`;
    }
  } else if (era) {
    eraPrompt = lang === 'zh' ? `${era}时期服饰风格` : `${era} era clothing style`;
  }
  let primaryVisualPrompt: string | undefined;
  if (lang === 'zh' || lang === 'zh+en') {
    // 中文优先（zh+en 只是让用户同时看到两种，生成时用中文）
    primaryVisualPrompt = visualPromptZh || visualPromptEn;
  } else {
    // en：英文优先
    primaryVisualPrompt = visualPromptEn || visualPromptZh;
  }
  
  // 构建角色描述：根据有无参考图决定使用完整锚点还是简化锚点
  let characterDescription = '';
  
  // 构建身份锚点提示词
  const anchorPrompt = buildPromptFromAnchors(identityAnchors, hasReferenceImages || false, promptLanguage);
  
  if (hasReferenceImages) {
    // 有参考图：简化描述，让参考图引导主要特征
    const basicDesc = primaryVisualPrompt ? primaryVisualPrompt.split(/[,，]/).slice(0, 3).join(',') : description.substring(0, 100);
    characterDescription = anchorPrompt 
      ? `${basicDesc}, ${anchorPrompt}` 
      : basicDesc;
  } else if (anchorPrompt) {
    // 无参考图 + 有锚点：完整6层锁定
    const baseDesc = primaryVisualPrompt || description;
    characterDescription = `${baseDesc}, ${anchorPrompt}`;
  } else if (primaryVisualPrompt) {
    // 使用AI大师提示词（已根据语言偏好选择）
    characterDescription = primaryVisualPrompt;
  } else {
    // 只有基础描述
    characterDescription = description;
  }
  
  // 加入年代服装提示词
  if (eraPrompt) {
    characterDescription = `${characterDescription}, ${eraPrompt}`;
  }

  const isZh = lang === 'zh';

  const basePrompt = isRealistic
    ? (isZh
        ? `专业角色参考图，"${name}"，${characterDescription}，真人写实`
        : `professional character reference for "${name}", ${characterDescription}, real person`)
    : (isZh
        ? `专业角色设计参考图，"${name}"，${characterDescription}`
        : `professional character design sheet for "${name}", ${characterDescription}`);
  
  // 使用 SHEET_ELEMENTS 定义的 prompt，如果是真人风格则转换成写实/摄影表述
  const contentParts = selectedElements
    .map(id => {
      const element = SHEET_ELEMENTS.find(e => e.id === id);
      if (!element) return null;
      if (isRealistic) {
        switch (id) {
          case 'three-view': return 'multiple photographic angles: front portrait, side profile, full body shot';
          case 'expressions': return 'collage of different facial expressions: smiling, frowning, angry, surprised';
          case 'proportions': return 'full body photography, standing straight';
          case 'poses': return 'various action poses, action photography collage';
          default: return element.prompt;
        }
      }
      return element.prompt;
    })
    .filter(Boolean);
  
  const contentPrompt = contentParts.join(', ');
  
  // 统一强化纯白背景，避免背景颜色被风格词带偏
  const whiteBackgroundPrompt = "pure solid white background, isolated character on white background, absolutely no background scenery";
  
  if (isRealistic) {
    return isZh
      ? `${basePrompt}, ${contentPrompt}, 摄影角色参考图版式, 拼贴格式, ${whiteBackgroundPrompt}, ${styleTokens}, 电影级灯光, 高细节皮肤纹理, 照片写实`
      : `${basePrompt}, ${contentPrompt}, photographic character reference layout, collage format, ${whiteBackgroundPrompt}, ${styleTokens}, cinematic lighting, highly detailed skin texture, photorealistic`;
  } else {
    return isZh
      ? `${basePrompt}, ${contentPrompt}, 角色参考图版式, ${whiteBackgroundPrompt}, ${styleTokens}, 精细插画`
      : `${basePrompt}, ${contentPrompt}, character reference sheet layout, ${whiteBackgroundPrompt}, ${styleTokens}, detailed illustration`;
  }
}

