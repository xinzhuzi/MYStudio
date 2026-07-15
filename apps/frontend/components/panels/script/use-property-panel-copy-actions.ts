import { useState } from "react";
import type {
  Episode,
  PromptLanguage,
  ScriptCharacter,
  ScriptScene,
  Shot,
} from "@/types/script";
import {
  CAMERA_MOVEMENT_PRESETS,
  SPECIAL_TECHNIQUE_PRESETS,
} from "@/stores/director-presets";

type CopyEpisodeDetail = Episode & { synopsis?: string };

export function usePropertyPanelCopyActions({
  character,
  scene,
  shot,
  episode,
  episodeShots,
  promptLanguage,
}: {
  character?: ScriptCharacter;
  scene?: ScriptScene;
  shot?: Shot;
  episode?: CopyEpisodeDetail;
  episodeShots: Shot[];
  promptLanguage: PromptLanguage;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedCharacter, setCopiedCharacter] = useState(false);
  const [copiedShotPrompts, setCopiedShotPrompts] = useState(false);
  const [copiedScene, setCopiedScene] = useState(false);

  // 复制场景数据
  const handleCopySceneData = async () => {
    if (!scene) return;
    
    const lines: string[] = [];
    lines.push(`# 场景设定：${scene.name || scene.location}`);
    lines.push('');
    
    // 基础信息
    lines.push(`## 基础信息`);
    lines.push(`地点：${scene.location}`);
    if (scene.time) lines.push(`时间：${scene.time}`);
    if (scene.atmosphere) lines.push(`氛围：${scene.atmosphere}`);
    lines.push('');
    
    // 场景设计（AI校准后）
    if (scene.architectureStyle || scene.lightingDesign || scene.colorPalette || scene.eraDetails) {
      lines.push(`## 场景设计`);
      if (scene.architectureStyle) lines.push(`建筑风格：${scene.architectureStyle}`);
      if (scene.lightingDesign) lines.push(`光影设计：${scene.lightingDesign}`);
      if (scene.colorPalette) lines.push(`色彩基调：${scene.colorPalette}`);
      if (scene.eraDetails) lines.push(`时代特征：${scene.eraDetails}`);
      if (scene.keyProps && scene.keyProps.length > 0) lines.push(`关键道具：${scene.keyProps.join('、')}`);
      if (scene.spatialLayout) lines.push(`空间布局：${scene.spatialLayout}`);
      lines.push('');
    }
    
    // 视觉提示词（按提示词语言显示）
    const includeZhScenePrompt = promptLanguage !== 'en';
    const includeEnScenePrompt = promptLanguage !== 'zh';
    if ((includeZhScenePrompt && scene.visualPrompt) || (includeEnScenePrompt && scene.visualPromptEn)) {
      lines.push(`## 视觉提示词`);
      if (includeZhScenePrompt && scene.visualPrompt) lines.push(`中文：${scene.visualPrompt}`);
      if (includeEnScenePrompt && scene.visualPromptEn) lines.push(`English: ${scene.visualPromptEn}`);
      lines.push('');
    }
    
    // 多视角联合图（AI视角分析的产出）
    if (scene.viewpoints && scene.viewpoints.length > 0) {
      lines.push(`## 多视角联合图（AI分析）`);
      lines.push(`视角数量：${scene.viewpoints.length} 个`);
      lines.push('');
      scene.viewpoints.forEach((vp, idx) => {
        lines.push(`### 视角 ${idx + 1}: ${vp.name}`);
        lines.push(`- ID: ${vp.id}`);
        if (vp.nameEn) lines.push(`- 英文名: ${vp.nameEn}`);
        if (vp.keyProps && vp.keyProps.length > 0) lines.push(`- 关键道具: ${vp.keyProps.join('、')}`);
        if (vp.shotIds && vp.shotIds.length > 0) lines.push(`- 关联分镜ID: ${vp.shotIds.join(', ')}`);
        lines.push(`- 网格位置: ${vp.gridIndex}`);
        lines.push('');
      });
    }
    
    // 出场统计
    if (scene.importance || scene.appearanceCount || scene.episodeNumbers?.length) {
      lines.push(`## 出场统计`);
      if (scene.importance) {
        const importanceLabel = scene.importance === 'main' ? '主场景' : 
                               scene.importance === 'secondary' ? '次要场景' : '过渡场景';
        lines.push(`重要程度：${importanceLabel}`);
      }
      if (scene.appearanceCount) lines.push(`出场次数：${scene.appearanceCount} 次`);
      if (scene.episodeNumbers && scene.episodeNumbers.length > 0) {
        lines.push(`出现集数：第 ${scene.episodeNumbers.join(', ')} 集`);
      }
      lines.push('');
    }
    
    const text = lines.join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
      setCopiedScene(true);
      setTimeout(() => setCopiedScene(false), 2000);
    } catch (e) {
      console.error('Copy scene failed:', e);
    }
  };

  // 复制角色数据
  const handleCopyCharacterData = async () => {
    if (!character) return;
    
    // 格式化角色数据
    const lines: string[] = [];
    lines.push(`# 角色设定：${character.name}`);
    lines.push('');
    
    // 基本信息（优先显示）
    if (character.gender || character.age) {
      lines.push(`## 基本信息`);
      const basicInfo: string[] = [];
      if (character.gender) basicInfo.push(`性别：${character.gender}`);
      if (character.age) basicInfo.push(`年龄：${character.age}`);
      lines.push(basicInfo.join(' | '));
      lines.push('');
    }
    
    // 身份/背景（主要描述）
    if (character.role) {
      lines.push(`## 身份/背景`);
      lines.push(character.role);
      lines.push('');
    }
    
    // 性格特征
    if (character.personality) {
      lines.push(`## 性格特征`);
      lines.push(character.personality);
      lines.push('');
    }
    
    // 核心特质
    if (character.traits) {
      lines.push(`## 核心特质`);
      lines.push(character.traits);
      lines.push('');
    }
    
    // 外貌特征
    if (character.appearance) {
      lines.push(`## 外貌特征`);
      lines.push(character.appearance);
      lines.push('');
    }
    
    // 技能/能力
    if (character.skills) {
      lines.push(`## 技能/能力`);
      lines.push(character.skills);
      lines.push('');
    }
    
    // 关键行为/事迹
    if (character.keyActions) {
      lines.push(`## 关键行为/事迹`);
      lines.push(character.keyActions);
      lines.push('');
    }
    
    // 人物关系
    if (character.relationships) {
      lines.push(`## 人物关系`);
      lines.push(character.relationships);
      lines.push('');
    }
    
    // === 6层身份锚点（角色一致性）===
    if (character.identityAnchors) {
      const anchors = character.identityAnchors;
      lines.push(`## 6层身份锚点`);
      
      // ① 骨相层
      const boneFeatures: string[] = [];
      if (anchors.faceShape) boneFeatures.push(`脸型: ${anchors.faceShape}`);
      if (anchors.jawline) boneFeatures.push(`下颌线: ${anchors.jawline}`);
      if (anchors.cheekbones) boneFeatures.push(`颧骨: ${anchors.cheekbones}`);
      if (boneFeatures.length > 0) {
        lines.push(`① 骨相层：${boneFeatures.join(', ')}`);
      }
      
      // ② 五官层
      const facialFeatures: string[] = [];
      if (anchors.eyeShape) facialFeatures.push(`眼型: ${anchors.eyeShape}`);
      if (anchors.eyeDetails) facialFeatures.push(`眼部细节: ${anchors.eyeDetails}`);
      if (anchors.noseShape) facialFeatures.push(`鼻型: ${anchors.noseShape}`);
      if (anchors.lipShape) facialFeatures.push(`唇型: ${anchors.lipShape}`);
      if (facialFeatures.length > 0) {
        lines.push(`② 五官层：${facialFeatures.join(', ')}`);
      }
      
      // ③ 辨识标记层（最强锚点）
      if (anchors.uniqueMarks && anchors.uniqueMarks.length > 0) {
        lines.push(`③ 辨识标记层（最强锚点）：${anchors.uniqueMarks.join('; ')}`);
      }
      
      // ④ 色彩锚点层
      if (anchors.colorAnchors) {
        const colors: string[] = [];
        if (anchors.colorAnchors.iris) colors.push(`虹膜: ${anchors.colorAnchors.iris}`);
        if (anchors.colorAnchors.hair) colors.push(`发色: ${anchors.colorAnchors.hair}`);
        if (anchors.colorAnchors.skin) colors.push(`肤色: ${anchors.colorAnchors.skin}`);
        if (anchors.colorAnchors.lips) colors.push(`唇色: ${anchors.colorAnchors.lips}`);
        if (colors.length > 0) {
          lines.push(`④ 色彩锚点层（Hex）：${colors.join(', ')}`);
        }
      }
      
      // ⑤ 皮肤纹理层
      if (anchors.skinTexture) {
        lines.push(`⑤ 皮肤纹理层：${anchors.skinTexture}`);
      }
      
      // ⑥ 发型锚点层
      const hairFeatures: string[] = [];
      if (anchors.hairStyle) hairFeatures.push(`发型: ${anchors.hairStyle}`);
      if (anchors.hairlineDetails) hairFeatures.push(`发际线: ${anchors.hairlineDetails}`);
      if (hairFeatures.length > 0) {
        lines.push(`⑥ 发型锚点层：${hairFeatures.join(', ')}`);
      }
      
      lines.push('');
    }
    
    // === 负面提示词 ===
    if (character.negativePrompt) {
      lines.push(`## 负面提示词`);
      if (character.negativePrompt.avoid && character.negativePrompt.avoid.length > 0) {
        lines.push(`要避免：${character.negativePrompt.avoid.join(', ')}`);
      }
      if (character.negativePrompt.styleExclusions && character.negativePrompt.styleExclusions.length > 0) {
        lines.push(`风格排除：${character.negativePrompt.styleExclusions.join(', ')}`);
      }
      lines.push('');
    }
    
    // 角色标签
    if (character.tags && character.tags.length > 0) {
      lines.push(`## 角色标签`);
      lines.push(character.tags.map(t => `#${t}`).join(' '));
      lines.push('');
    }
    
    // 角色备注
    if (character.notes) {
      lines.push(`## 角色备注`);
      lines.push(character.notes);
      lines.push('');
    }
    
    const text = lines.join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCharacter(true);
      setTimeout(() => setCopiedCharacter(false), 2000);
    } catch (e) {
      console.error('Copy character failed:', e);
    }
  };

  // 复制集分镜数据
  const handleCopyEpisodeShots = async () => {
    if (!episode || episodeShots.length === 0) return;
    
    // 情绪标签中文映射
    const emotionLabels: Record<string, string> = {
      happy: '开心', sad: '悲伤', angry: '愤怒', surprised: '惊讶', fearful: '恐惧', calm: '平静',
      tense: '紧张', excited: '兴奋', mysterious: '神秘', romantic: '浪漫', funny: '搞笑', touching: '感动',
      serious: '严肃', relaxed: '轻松', playful: '调侃', gentle: '温柔', passionate: '激昂', low: '低沉'
    };
    
    // 格式化分镜数据
    const lines: string[] = [];
    lines.push(`# 第${episode.index}集：${episode.title.replace(/^第\d+集[：:]?/, '')}`);
    lines.push('');
    if (episode.synopsis) {
      lines.push(`## 本集大纲`);
      lines.push(episode.synopsis);
      lines.push('');
    }
    lines.push(`## 分镜列表 (共 ${episodeShots.length} 个)`);
    lines.push('');
    
    episodeShots.forEach((s, idx) => {
      lines.push(`### 分镜 ${String(idx + 1).padStart(2, '0')}`);
      if (s.shotSize || s.cameraMovement) {
        lines.push(`**镜头**: ${[s.shotSize, s.cameraMovement].filter(Boolean).join(' | ')}`);
      }
      if ((s as any).visualDescription) {
        lines.push(`**视觉描述**: ${(s as any).visualDescription}`);
      }
      if (s.actionSummary) {
        lines.push(`**动作**: ${s.actionSummary}`);
      }
      if (s.dialogue) {
        lines.push(`**对白**: 「${s.dialogue}」`);
      }
      if (s.characterNames && s.characterNames.length > 0) {
        lines.push(`**出场角色**: ${s.characterNames.join('、')}`);
      }
      if (s.emotionTags && s.emotionTags.length > 0) {
        const tags = s.emotionTags.map(t => emotionLabels[t] || t).join('、');
        lines.push(`**情绪**: ${tags}`);
      }
      if (promptLanguage !== 'zh' && (s as any).visualPrompt) {
        lines.push(`**英文Prompt**: ${(s as any).visualPrompt}`);
      }
      // 三层提示词系统
      if (s.imagePromptZh || s.imagePrompt) {
        if (promptLanguage === 'zh') {
          lines.push(`**首帧提示词**: ${s.imagePromptZh || ''}`);
        } else if (promptLanguage === 'en') {
          lines.push(`**首帧提示词**: ${s.imagePrompt || ''}`);
        } else {
          lines.push(`**首帧提示词**: ${s.imagePromptZh || ''} ${s.imagePrompt ? `(EN: ${s.imagePrompt})` : ''}`);
        }
      }
      if (s.videoPromptZh || s.videoPrompt) {
        if (promptLanguage === 'zh') {
          lines.push(`**视频提示词**: ${s.videoPromptZh || ''}`);
        } else if (promptLanguage === 'en') {
          lines.push(`**视频提示词**: ${s.videoPrompt || ''}`);
        } else {
          lines.push(`**视频提示词**: ${s.videoPromptZh || ''} ${s.videoPrompt ? `(EN: ${s.videoPrompt})` : ''}`);
        }
      }
      if (s.needsEndFrame) {
        lines.push(`**需要尾帧**: 是`);
        if (s.endFramePromptZh || s.endFramePrompt) {
          if (promptLanguage === 'zh') {
            lines.push(`**尾帧提示词**: ${s.endFramePromptZh || ''}`);
          } else if (promptLanguage === 'en') {
            lines.push(`**尾帧提示词**: ${s.endFramePrompt || ''}`);
          } else {
            lines.push(`**尾帧提示词**: ${s.endFramePromptZh || ''} ${s.endFramePrompt ? `(EN: ${s.endFramePrompt})` : ''}`);
          }
        }
      }
      lines.push('');
    });
    
    const text = lines.join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  // 复制当前分镜的三层提示词
  const handleCopyShotTriPrompts = async () => {
    if (!shot) return;

    const hasTri = !!(
      shot.imagePrompt || shot.imagePromptZh ||
      shot.videoPrompt || shot.videoPromptZh ||
      shot.endFramePrompt || shot.endFramePromptZh
    );

    // 景别中文映射
    const shotSizeLabels: Record<string, string> = {
      'ECU': '特写', 'CU': '近景', 'MCU': '中近景', 'MS': '中景',
      'MLS': '中远景', 'LS': '远景', 'ELS': '大远景', 'POV': '主观镜头'
    };
    // 镜头运动中文映射（兼容旧值+新预设ID）
    const cameraLabelsLegacy: Record<string, string> = {
      'Static': '固定', 'Pan': '横摇', 'Tilt': '俯仰', 'Dolly': '推拉',
      'Zoom': '变焦', 'Tracking': '跟拍', 'Crane': '升降', 'Handheld': '手持'
    };
    const cameraLabels = (id: string) => {
      const preset = CAMERA_MOVEMENT_PRESETS.find(p => p.id === id);
      return preset ? preset.label : (cameraLabelsLegacy[id] || id);
    };
    const specialTechniqueLabel = (id: string) => {
      const preset = SPECIAL_TECHNIQUE_PRESETS.find(p => p.id === id);
      return preset ? preset.label : id;
    };

    const lines: string[] = [];
    lines.push('═══════════════════════════════════════');
    lines.push(`分镜 ${shot.index} - 三层提示词数据`);
    lines.push('═══════════════════════════════════════');
    lines.push('');

    // 基础信息
    lines.push('【基础信息】');
    if (shot.shotSize) {
      lines.push(`景别: ${shotSizeLabels[shot.shotSize] || shot.shotSize} (${shot.shotSize})`);
    }
    if (shot.cameraMovement) {
      lines.push(`镜头运动: ${cameraLabels(shot.cameraMovement)}`);
    }
    if (shot.specialTechnique && shot.specialTechnique !== 'none') {
      lines.push(`特殊拍摄: ${specialTechniqueLabel(shot.specialTechnique)}`);
    }
    if (shot.duration) {
      lines.push(`时长: ${shot.duration}秒`);
    }
    if (shot.characterNames && shot.characterNames.length > 0) {
      lines.push(`出场角色: ${shot.characterNames.join('、')}`);
    }
    // 对白字段始终显示，无对白时明确标注“无”，防止AI视频模型幻觉
    lines.push(`对白: ${shot.dialogue ? `「${shot.dialogue}」` : '无'}`);
    if (shot.actionSummary) {
      lines.push(`动作描述: ${shot.actionSummary}`);
    }
    lines.push('');

    // 视觉描述
    if ((shot as any).visualDescription) {
      lines.push('【视觉描述】');
      lines.push((shot as any).visualDescription);
      lines.push('');
    }

    // 音频设计
    if (shot.ambientSound || shot.soundEffect) {
      lines.push('【音频设计】');
      if (shot.ambientSound) {
        lines.push(`环境音: ${shot.ambientSound}`);
      }
      if (shot.soundEffect) {
        lines.push(`音效: ${shot.soundEffect}`);
      }
      lines.push('');
    }

    // 叙事驱动设计（基于《电影语言的语法》）
    const hasNarrative = (shot as any).narrativeFunction || (shot as any).shotPurpose || 
                         (shot as any).visualFocus || (shot as any).cameraPosition || 
                         (shot as any).characterBlocking || (shot as any).rhythm;
    if (hasNarrative) {
      lines.push('【叙事驱动设计】基于《电影语言的语法》');
      if ((shot as any).narrativeFunction) {
        lines.push(`叙事功能: ${(shot as any).narrativeFunction}`);
      }
      if ((shot as any).shotPurpose) {
        lines.push(`镜头目的: ${(shot as any).shotPurpose}`);
      }
      if ((shot as any).visualFocus) {
        lines.push(`视觉焦点: ${(shot as any).visualFocus}`);
      }
      if ((shot as any).cameraPosition) {
        lines.push(`机位描述: ${(shot as any).cameraPosition}`);
      }
      if ((shot as any).characterBlocking) {
        lines.push(`人物布局: ${(shot as any).characterBlocking}`);
      }
      if ((shot as any).rhythm) {
        lines.push(`节奏: ${(shot as any).rhythm}`);
      }
      lines.push('');
    }

    if (!hasTri) {
      lines.push('⚠️ 该分镜尚未生成三层提示词，请先执行"AI校准分镜"。');
    } else {
      // ===== 首帧提示词 =====
      lines.push('───────────────────────────────────────');
      lines.push('【首帧提示词】用于生成视频的第一帧图片');
      lines.push('───────────────────────────────────────');
      if (promptLanguage !== 'en' && shot.imagePromptZh) {
        lines.push(`中文: ${shot.imagePromptZh}`);
      }
      if (promptLanguage !== 'zh' && shot.imagePrompt) {
        lines.push(`English: ${shot.imagePrompt}`);
      }
      if (
        (promptLanguage === 'zh' && !shot.imagePromptZh) ||
        (promptLanguage === 'en' && !shot.imagePrompt) ||
        (promptLanguage === 'zh+en' && !shot.imagePrompt && !shot.imagePromptZh)
      ) {
        lines.push('(未生成)');
      }
      lines.push('');

      // ===== 视频提示词 =====
      lines.push('───────────────────────────────────────');
      lines.push('【视频提示词】用于图生视频，描述动作和运动');
      lines.push('───────────────────────────────────────');
      if (promptLanguage !== 'en' && shot.videoPromptZh) {
        lines.push(`中文: ${shot.videoPromptZh}`);
      }
      if (promptLanguage !== 'zh' && shot.videoPrompt) {
        lines.push(`English: ${shot.videoPrompt}`);
      }
      if (
        (promptLanguage === 'zh' && !shot.videoPromptZh) ||
        (promptLanguage === 'en' && !shot.videoPrompt) ||
        (promptLanguage === 'zh+en' && !shot.videoPrompt && !shot.videoPromptZh)
      ) {
        lines.push('(未生成)');
      }
      lines.push('');

      // ===== 尾帧提示词 =====
      lines.push('───────────────────────────────────────');
      lines.push('【尾帧提示词】用于生成视频的最后一帧（如需要）');
      lines.push('───────────────────────────────────────');
      if (shot.needsEndFrame) {
        lines.push('需要尾帧: ✓ 是');
        if (promptLanguage !== 'en' && shot.endFramePromptZh) {
          lines.push(`中文: ${shot.endFramePromptZh}`);
        }
        if (promptLanguage !== 'zh' && shot.endFramePrompt) {
          lines.push(`English: ${shot.endFramePrompt}`);
        }
        if (
          (promptLanguage === 'zh' && !shot.endFramePromptZh) ||
          (promptLanguage === 'en' && !shot.endFramePrompt) ||
          (promptLanguage === 'zh+en' && !shot.endFramePrompt && !shot.endFramePromptZh)
        ) {
          lines.push('(未生成)');
        }
      } else {
        lines.push('需要尾帧: ✗ 否（此分镜不需要单独的尾帧）');
      }
    }

    lines.push('');
    lines.push('═══════════════════════════════════════');

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedShotPrompts(true);
      setTimeout(() => setCopiedShotPrompts(false), 2000);
    } catch (e) {
      console.error('Copy tri-layer prompts failed:', e);
    }
  };

  return {
    copied,
    copiedCharacter,
    copiedShotPrompts,
    copiedScene,
    handleCopySceneData,
    handleCopyCharacterData,
    handleCopyEpisodeShots,
    handleCopyShotTriPrompts,
  };
}
