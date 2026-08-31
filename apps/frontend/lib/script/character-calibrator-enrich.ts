import { CalibratedCharacter } from "./character-calibrator-normalizers";
import { aiManager } from "@/lib/ai/ai-manager";
import type { EpisodeRawScript, ProjectBackground, PromptLanguage } from "@/types/script";

/**
 * 角色视觉提示词增强——enrichCharactersWithVisualPrompts(主角/重要配角的世界级角色设计提示词生成,含年代服装指导与逐角色容错)。file-size-reduction P2 拆出,体逐字保留。
 */

/**
 * 收集角色出场上下文（用于AI分析）
 */

// ==================== 专业角色设计 ====================

/**
 * 为主角和重要配角生成专业的视觉提示词
 * 调用世界级角色设计大师 AI
 */
export async function enrichCharactersWithVisualPrompts(
  characters: CalibratedCharacter[],
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  promptLanguage: PromptLanguage = 'zh+en'
): Promise<CalibratedCharacter[]> {
  // 只为主角和重要配角生成详细提示词
  const keyCharacters = characters.filter(c => 
    c.importance === 'protagonist' || c.importance === 'supporting'
  );
  
  if (keyCharacters.length === 0) {
    return characters;
  }
  
  
  // 构建时代服装指导
  const getEraFashionGuidance = () => {
    const startYear = background.storyStartYear;
    const timeline = background.timelineSetting || background.era || '现代';
    
    if (startYear) {
      if (startYear >= 2020) {
        return `【${startYear}年代服装指导】
- 年轻人：休闲时尚、运动风、潮牌元素，常穿卫衣、牢仔裤、运动鞋
- 中年人：商务休闲、简约现代，常穿Polo衫、休闲西装、卡其裤
- 老年人：舒适休闲，常穿开衫、孖子衫、布鞋或运动鞋`;
      } else if (startYear >= 2010) {
        return `【${startYear}年代服装指导】
- 年轻人：韩系时尚、小清新风格，常穿T恤、牢仔裤、帆布鞋
- 中年人：商务正装或商务休闲，常穿西装、衬衫、皮鞋
- 老年人：传统休闲，常穿开衫、布鞋`;
      } else if (startYear >= 2000) {
        return `【${startYear}年代服装指导】
- 年轻人：千禅年时尚，常穿紧身裤、宽松外套、板鞋
- 中年人：正式商务装，常穿西装套装、领带、皮鞋
- 老年人：中山装或简单开衫、布鞋`;
      } else if (startYear >= 1990) {
        return `【${startYear}年代服装指导】
- 年轻人：喝叭裤、确良外套、大肩垫西装、特宾球鞋
- 中年人：中山装或西装，常穿解放鞋或简单皮鞋
- 老年人：中山装、棉袄、布鞋`;
      } else {
        return `【${startYear}年代服装指导】
请根据该年代的中国实际服装风格设计，避免古装或不符合时代的服装`;
      }
    }
    
    // 如果没有精确年份，根据 era 判断
    if (timeline.includes('现代') || timeline.includes('当代')) {
      return `【现代服装指导】
请设计符合当代中国的服装风格，年轻人穿时尚休闲装，中年人穿商务休闲装，老年人穿舒适传统服装。
绝对不要设计成古装、汉服、或古代服饰。`;
    }

    // 民国时期
    if (timeline.includes('民国') || timeline.includes('近代') || timeline.includes('清末')) {
      return `【${timeline}服装指导】
- 男性：长衫马褂、中山装、西装礼帽（上层社会）、布衣长衫（平民）
- 女性：旗袍、女学生装（上衣下裙）、短发或盘发
- 禁止出现T恤、牛仔裤、运动鞋等现代服饰
- 禁止出现手机、电脑等现代电子产品`;
    }

    // 古代各朝代
    if (/唐朝|唐代/.test(timeline)) {
      return `【唐朝服装指导】
- 男性：圆领袍、幞头、革带；武将可穿铠甲
- 女性：高腰襟裙、披帛、发髀簪起、花钗装饰
- 绝对禁止任何现代服装（西装/T恤/牵仔裤/运动鞋）`;
    }
    if (/宋朝|宋代/.test(timeline)) {
      return `【宋朝服装指导】
- 男性：直裰、交领袖衫、乌纱帽；文人偏素雅
- 女性：褒子、裙、披帛，发型简约典雅
- 绝对禁止任何现代服装`;
    }
    if (/明朝|明代/.test(timeline)) {
      return `【明朝服装指导】
- 男性：曳服、直裰、网巾或乌纱帽
- 女性：交领衫、马面裙、披风，发型丰富多变
- 绝对禁止任何现代服装`;
    }
    if (/清朝|清代/.test(timeline)) {
      return `【清朝服装指导】
- 男性：长袍马褂、瓜皮帽、辨子；官员穿补服
- 女性：旗装（溜肩、立领、宽松）、旗头或两把头
- 绝对禁止任何现代服装`;
    }

    // 泛古代/武侠/仙侠/宫斗/玄幻等
    if (/古代|武侠|仙侠|玄幻|宫斗|宅斗|战国|春秋|汉朝|三国|历史/.test(timeline)) {
      return `【${timeline}服装指导】
- 所有角色必须穿着中国古代服饰（长袍、袖衫、披风、带子等）
- 发型必须是古代式样（簪发、发髀、束发、发笪等）
- 武侠/仙侠可加入飘逸江湖风格元素（剑、披风、护腕等）
- 绝对禁止任何现代服装（西装/T恤/牛仔裤/运动鞋/手机/眼镜等）`;
    }

    // 科幻/未来
    if (/科幻|未来|星际|太空/.test(timeline)) {
      return `【${timeline}服装指导】
- 可以设计未来感/科技感服装，但需保持内部一致性
- 禁止出现与世界观不符的服装元素`;
    }

    // 其他未识别的时代 — 用通用约束而非返回空
    return `【${timeline}服装指导】
请根据「${timeline}」时代背景设计角色服装，服装、发型、配饰必须严格符合该时代特征。
绝对禁止出现与该时代不符的服装元素。`;
  };
  
  const eraFashionGuidance = getEraFashionGuidance();
  
  // 系统提示词：角色设计大师 + 背景信息 + 输出格式（不含具体角色）
  const systemPrompt = `你是好莱坞顶级角色设计大师，曾为漫威、迪士尼、皮克斯设计过无数经典角色。

你的专业能力：
- **角色视觉设计**：能准确捕捉角色的外在形象、服装风格、肢体语言
- **年代服装专家**：精通不同年代的中国服装潮流，能准确还原历史时期的服装特征
- **AI图像生成专家**：深谙 Midjourney、DALL-E、Stable Diffusion 等 AI 绘图模型
- **角色一致性专家**：掌握"6层特征锁定"技术，确保同一角色在不同场景保持一致

【剧本信息】
剧名：《${background.title}》
类型：${background.genre || '未知类型'}
时代背景：${background.era || '现代'}
精确时间线：${background.timelineSetting || '未指定'}
故事年份：${background.storyStartYear ? `${background.storyStartYear}年` : '未指定'}${background.storyEndYear && background.storyEndYear !== background.storyStartYear ? ` - ${background.storyEndYear}年` : ''}
总集数：${episodeScripts.length}集

${eraFashionGuidance}

【故事大纲】
${background.outline?.slice(0, 1200) || '无'}

【人物小传】
${background.characterBios?.slice(0, 1200) || '无'}

${promptLanguage === 'zh' ? `【核心输出：6层身份锚点】
这是AI生图中保持角色一致性的关键技术，必须用中文详细填写：

① 骨相层（面部骨骼结构）
   - faceShape: 脸型（鹅蛋形/方形/心形/圆形/菱形/长圆形）
   - jawline: 下颌线（棱角分明/柔和圆润/突出方正）
   - cheekbones: 颧骨（高颧骨/不明显/宽颧骨）

② 五官层（精确描述）
   - eyeShape: 眼型（杏仁形/圆眼/内双/单眼皮/上挑形）
   - eyeDetails: 眼部细节（双眼皮、轻微内眦褶、深邃眼窝）
   - noseShape: 鼻型（高鼻梁、圆鼻头、小巧挺鼻）
   - lipShape: 唇型（丰唇、薄唇、明显的唇珠）

③ 辨识标记层（最强锚点！）
   - uniqueMarks: 必填数组！至少2-3个独特标记，用中文描述
   - 示例：["左眼下方2cm处小痣", "右眉尾处淡疤", "左脸颊酒窝"]
   - 这是最强的角色识别特征，必须精确到位置

④ 色彩锚点层（Hex色值）
   - colorAnchors.iris: 虹膜色（如 #3D2314 深棕色）
   - colorAnchors.hair: 发色（如 #1A1A1A 乌黑）
   - colorAnchors.skin: 肤色（如 #E8C4A0 暖米色）
   - colorAnchors.lips: 唇色（如 #C4727E 豆沙粉）

⑤ 皮肤纹理层
   - skinTexture: 皮肤质感，用中文描述（毛孔清晰、淡雀斑、笑纹明显）

⑥ 发型锚点层
   - hairStyle: 发型，用中文描述（齐肩层次剪、寸头、波波头）
   - hairlineDetails: 发际线，用中文描述（自然发际线、美人尖、额角后退）

【负面提示词】
为角色生成negativePrompt，排除不符合设定的特征，用中文填写：
- avoid: 要避免的特征（如中国人角色应避免 金色头发、蓝色眼睛）
- styleExclusions: 风格排除（如 动漫风、卡通风、油画风）` : `【核心输出：6层身份锚点】
这是AI生图中保持角色一致性的关键技术，必须详细填写：

① 骨相层（面部骨骼结构）
   - faceShape: 脸型（oval/square/heart/round/diamond/oblong）
   - jawline: 下颌线（sharp angular/soft rounded/prominent）
   - cheekbones: 颧骨（high prominent/subtle/wide set）

② 五官层（精确描述）
   - eyeShape: 眼型（almond/round/hooded/monolid/upturned）
   - eyeDetails: 眼部细节（double eyelids, slight epicanthic fold, deep-set）
   - noseShape: 鼻型（straight bridge, rounded tip, button nose）
   - lipShape: 唇型（full lips, thin lips, defined cupid's bow）

③ 辨识标记层（最强锚点！）
   - uniqueMarks: 必填数组！至少2-3个独特标记
   - 示例：["small mole 2cm below left eye", "faint scar on right eyebrow", "dimple on left cheek"]
   - 这是最强的角色识别特征，必须精确到位置

④ 色彩锚点层（Hex色值）
   - colorAnchors.iris: 虹膜色（如 #3D2314 dark brown）
   - colorAnchors.hair: 发色（如 #1A1A1A jet black）
   - colorAnchors.skin: 肤色（如 #E8C4A0 warm beige）
   - colorAnchors.lips: 唇色（如 #C4727E dusty rose）

⑤ 皮肤纹理层
   - skinTexture: 皮肤质感（visible pores, light freckles, smile lines）

⑥ 发型锚点层
   - hairStyle: 发型（shoulder-length layered, buzz cut, bob）
   - hairlineDetails: 发际线（natural, widow's peak, receding）

【负面提示词】
为角色生成negativePrompt，排除不符合设定的特征：
- avoid: 要避免的特征（如中国人角色应避免 blonde hair, blue eyes）
- styleExclusions: 风格排除（如 anime style, cartoon, painting）`}

【服装要求】
- 服装必须严格符合故事设定的时代背景（${background.era || '现代'}）
- 根据角色年龄和身份设计合适的服装
- 绝对不要设计与剧本时代不符的服饰（如古装剧禁止现代服装，现代剧禁止古代服饰）

请返回JSON格式（注意：只返回单个角色对象，不要数组包裹）：
{
  "name": "角色名",
  "detailedDescription": "详细的中文角色描述（100-200字）",
${promptLanguage === 'zh' ? '  "visualPromptZh": "中文视觉提示词",' : promptLanguage === 'en' ? '  "visualPromptEn": "English visual prompt, 40-60 words",' : '  "visualPromptEn": "English visual prompt, 40-60 words",\n  "visualPromptZh": "中文视觉提示词",'}
  "clothingStyle": "符合年代的服装风格",
  "identityAnchors": {
${promptLanguage === 'zh' ? `    "faceShape": "长圆形",
    "jawline": "柔和圆润，略带宽度",
    "cheekbones": "不明显",
    "eyeShape": "杏仁形，略下垂",
    "eyeDetails": "双眼皮，眼神温和",
    "noseShape": "高鼻梁，圆鼻头",
    "lipShape": "丰唇",
    "uniqueMarks": ["左眼下方小痣", "右脸颊酒窝"],` : `    "faceShape": "oval",
    "jawline": "soft rounded",
    "cheekbones": "subtle",
    "eyeShape": "almond",
    "eyeDetails": "double eyelids, warm gaze",
    "noseShape": "straight bridge, rounded tip",
    "lipShape": "full lips",
    "uniqueMarks": ["small mole below left eye", "dimple on right cheek"],`}
    "colorAnchors": {
      "iris": "#3D2314",
      "hair": "#1A1A1A",
      "skin": "#E8C4A0",
      "lips": "#C4727E"
    },
${promptLanguage === 'zh' ? `    "skinTexture": "皮肤光滑，有轻微笑纹",
    "hairStyle": "短发整齐商务剪",
    "hairlineDetails": "自然发际线"` : `    "skinTexture": "smooth with light smile lines",
    "hairStyle": "short neat business cut",
    "hairlineDetails": "natural hairline"`}
  },
  "negativePrompt": {
${promptLanguage === 'zh' ? `    "avoid": ["金色头发", "蓝色眼睛", "胡须", "纹身"],
    "styleExclusions": ["动漫风", "卡通风", "油画风", "素描风"]` : `    "avoid": ["blonde hair", "blue eyes", "beard", "tattoos"],
    "styleExclusions": ["anime", "cartoon", "painting", "sketch"]`}
  }
}`;

  // 逐个角色调用 AI，避免一次性输出过多 JSON 导致推理模型 token 耗尽
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const designMap = new Map<string, any>();
  
  for (let i = 0; i < keyCharacters.length; i++) {
    const c = keyCharacters[i];
 
    
    const userPrompt = `请为以下角色生成专业视觉提示词和6层身份锚点：

${c.name}（${c.importance === 'protagonist' ? '主角' : '重要配角'}）
- 身份：${c.role || '未知'}
- 年龄：${c.age || '未知'}
- 性别：${c.gender || '未知'}
- 出场：${c.appearanceCount}次`;
    
    try {
      const result = await aiManager.featureText('script_analysis', systemPrompt, userPrompt, {
        maxTokens: 4096, // 单角色输出 4096 足够
      });
      
      // 解析单角色 JSON
      let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      }
      
      const parsed = JSON.parse(cleaned);
      // 兼容：AI 可能返回 { characters: [...] } 或直接返回单角色对象
      const design = parsed.characters ? parsed.characters[0] : parsed;
      if (design) {
        designMap.set(design.name || c.name, design);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn(`[enrichCharactersWithVisualPrompts] ⚠️ ${c.name} 生成失败（不影响其他角色）:`, err.message);
      // 单个角色失败不影响整体，继续处理下一个
    }
  }
  
  
  // 合并到角色数据
  return characters.map(c => {
    const design = designMap.get(c.name);
    if (design) {
      // 提取 identityAnchors
      const anchors = design.identityAnchors;
      
      // 从新的 identityAnchors 中提取兼容字段（根据锚点值语言自动适配标签）
      const isChinese = /[\u4e00-\u9fff]/.test(anchors?.faceShape || anchors?.eyeShape || '');
      const facialFeatures = anchors ? [
        anchors.faceShape && (isChinese ? `脸型：${anchors.faceShape}` : `Face: ${anchors.faceShape}`),
        anchors.eyeShape && (isChinese ? `眼型：${anchors.eyeShape}` : `Eyes: ${anchors.eyeShape}`),
        anchors.eyeDetails,
        anchors.noseShape && (isChinese ? `鼻型：${anchors.noseShape}` : `Nose: ${anchors.noseShape}`),
        anchors.lipShape && (isChinese ? `唇型：${anchors.lipShape}` : `Lips: ${anchors.lipShape}`),
      ].filter(Boolean).join(', ') : design.facialFeatures;
      
      // uniqueMarks 从 anchors.uniqueMarks 数组转换为字符串（向后兼容）
      const uniqueMarks = anchors?.uniqueMarks 
        ? (Array.isArray(anchors.uniqueMarks) ? anchors.uniqueMarks.join('; ') : anchors.uniqueMarks)
        : design.uniqueMarks;
      
      return {
        ...c,
        role: design.detailedDescription || c.role,
        visualPromptEn: design.visualPromptEn,
        visualPromptZh: design.visualPromptZh,
        facialFeatures,
        uniqueMarks,
        clothingStyle: design.clothingStyle,
        // 新增：6层身份锚点
        identityAnchors: anchors,
        // 新增：负面提示词
        negativePrompt: design.negativePrompt,
      };
    }
    return c;
  });
}
