import { aiManager } from "@/lib/ai/ai-manager";
import { buildCinematographyGuidance } from "@/lib/constants/cinematography-profiles";
import { getMediaType, getStyleDescription } from "@/lib/constants/visual-styles";
import { getMediaTypeGuidance } from "@/lib/generation/media-type-tokens";
import type { PromptLanguage } from "@/types/script";
import {
  parseShotCalibrationResponse,
  type ShotCalibrationResponse,
} from "./shot-calibration-response";

export interface ShotCalibrationOptions {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  model?: string;
  styleId?: string;
  cinematographyProfileId?: string;
  promptLanguage?: PromptLanguage;
}

export async function callAIForShotCalibration(
  shots: Array<{
    shotId: string;
    sourceText: string;        // 原始剧本文本片段（该分镜对应的原文）
    actionSummary: string;
    dialogue?: string;
    characterNames?: string[];
    sceneLocation: string;
    sceneAtmosphere: string;
    sceneTime: string;
    sceneWeather?: string;        // 天气（雨/雪/雾等）
    // 场景美术设计字段（与 ScriptScene 字段名对齐）
    architectureStyle?: string;   // 建筑风格
    colorPalette?: string;        // 色彩基调
    eraDetails?: string;          // 时代特征
    lightingDesign?: string;      // 光影设计
    currentShotSize?: string;
    currentCameraMovement?: string;
    currentDuration?: number;
  }>,
  options: ShotCalibrationOptions,
  globalContext: {
    title: string;
    genre?: string;
    era?: string;
    outline: string;
    characterBios: string;
    worldSetting?: string;
    themes?: string[];
    episodeTitle: string;
    episodeSynopsis?: string;  // 每集大纲
    episodeKeyEvents?: string[];  // 关键事件
    episodeRawContent?: string;  // 该集原始剧本内容
    episodeSeason?: string;      // 本集季节
    totalEpisodes?: number;
    currentEpisode?: number;
  }
): Promise<Record<string, ShotCalibrationResponse>> {
  // 不再需要 apiKey/provider/baseUrl，统一从服务映射获取
  const { styleId, cinematographyProfileId } = options;
  const { 
    title, genre, era, outline, characterBios, worldSetting, themes,
    episodeTitle, episodeSynopsis, episodeKeyEvents, episodeRawContent,
    episodeSeason, totalEpisodes, currentEpisode 
  } = globalContext;
  
  // 截取原始剧本内容（避免过长，取前3000字）
  const rawContentPreview = episodeRawContent ? episodeRawContent.slice(0, 3000) : '';
  
  // 使用共享的风格描述函数
  const styleDesc = getStyleDescription(styleId || 'cinematic');
  
  // 摄影风格档案指导文本
  const cinematographyGuidance = cinematographyProfileId
    ? buildCinematographyGuidance(cinematographyProfileId)
    : '';
  
  // 构建更完整的上下文信息
  const contextInfo = [
    `剧名：《${title}》`,
    genre ? `类型：${genre}` : '',
    era ? `时代背景：${era}` : '',
    totalEpisodes ? `总集数：${totalEpisodes}集` : '',
    `当前：第${currentEpisode}集「${episodeTitle}」`,
    episodeSeason ? `季节：${episodeSeason}` : '',
  ].filter(Boolean).join(' | ');
  
  const systemPrompt = `你是世界级顶尖电影摄影大师，精通丹尼艾尔·阿里洪《电影语言的语法》的所有理论，拥有奥斯卡最佳摄影奖经验。

你的核心理念：**镜头不是孤立的画面，而是叙事链条中的一环。每个镜头的景别、运动、时长都必须服务于叙事。**

你的专业能力：
- 精通镜头语言：能准确判断每个镜头的景别、运动方式、光线设计
- **叙事驱动设计**：理解每个镜头在整集故事中的位置和功能，确保镜头设计服务于叙事
- 场面调度：运用三角形原理、内外反拍等技法处理对话场面
- 动态捕捉：能准确判断镜头的起始状态和结束状态是否有显著差异
- AI视频生成经验：深谙 Seedance、Sora、Runway 等 AI 视频模型的工作原理

你的任务是根据剧本全局背景和分镜信息，为每个分镜生成专业的视觉描述和三层提示词。

【剧本信息】
${contextInfo}
${episodeSynopsis ? `
本集大纲：${episodeSynopsis}` : ''}
${episodeKeyEvents && episodeKeyEvents.length > 0 ? `
关键事件：${episodeKeyEvents.join('、')}` : ''}
${worldSetting ? `
世界观：${worldSetting.slice(0, 200)}` : ''}
${themes && themes.length > 0 ? `
主题：${themes.join('、')}` : ''}
${outline ? `
故事背景：${outline.slice(0, 400)}` : ''}
${characterBios ? `
主要人物：${characterBios.slice(0, 400)}` : ''}

【⚠️ 核心原则 - 必须严格遵守】

1. **场景归属绝对固定**（最重要！）：
   - 每个分镜都有一个【主场景】（由 sceneLocation 字段指定），这是**绝对不可更改的**
   - 即使分镜描述中提到了其他场景（如闪回、叠画、回忆画面、穿插镜头），**主场景仍然是 sceneLocation**
   - 闪回/叠画是「当前主场景内的视觉表现手法」，不是场景切换
   - 你生成的所有描述（visualDescription、imagePrompt 等）都必须以**主场景为背景**
   - 如果原文包含闪回/叠画内容，用「画面叠加」「画中画」「主观回忆」等方式描述，而不是描述成另一个场景
   - 例：主场景是"张家客厅"，原文提到"闪回台球厅"，应描述为"张家客厅中，画面叠加台球厅的回忆画面"

2. **严格基于原文**：每个分镜都附带了【原始剧本文本】，你的所有生成内容必须完全基于该原文：
   - 视觉描述必须包含原文中提到的所有关键元素（人物、动作、道具、场景）
   - 不得添加原文中没有的内容
   - 不得混入其他分镜的内容
   - 不得遗漏原文中的重要信息

3. **角色完整识别**：出场角色必须完整来自原文，按出现顺序列出
   - 例：原文"张明与父母吃着饭" → characterNames: ["张明", "张父", "张母"]
   - 禁止遗漏角色，禁止新增原文中没有的角色

3. **中英文分离**：
   - **中文字段**（visualDescription, ambientSound, soundEffect, imagePromptZh, videoPromptZh, endFramePromptZh）：必须是纯中文
   - **英文字段**（visualPrompt, imagePrompt, videoPrompt, endFramePrompt）：必须是100%纯英文，绝对禁止夹杂任何中文字符
   - 如果不确定某个词怎么翻译，用英文描述或近义词代替，但绝不能留中文

4. **时长估算**：根据动作复杂度和对白长度估算合理的分镜时长（秒）
   - 纯动作无对白：3-5秒
   - 简短对白：4-6秒
   - 较长对白：6-10秒
   - 复杂动作序列：5-8秒

5. **音频设计**（必须用中文）：根据原文识别并输出：
   - ambientSound（环境音）：如"窗外鸟鸣"、"餐厅嗨杂声"、"风声"
   - soundEffect（音效）：如"酒杯碎裂声"、"脚步声"、"门关闭声"

【任务】
为每个分镜生成：

**基础字段：**
1. 中文视觉描述 (visualDescription): 详细、有画面感的**纯中文**描述，必须包含原文所有关键元素（环境、人物、动作、道具）
2. 英文视觉描述 (visualPrompt): 用于AI绘图的**纯英文**描述，40词内
3. 景别 (shotSize): ECU/CU/MCU/MS/MLS/LS/WS/FS
4. 镜头运动 (cameraMovement): none/static/tracking/orbit/zoom-in/zoom-out/pan-left/pan-right/tilt-up/tilt-down/dolly-in/dolly-out/truck-left/truck-right/crane-up/crane-down/drone-aerial/360-roll
4b. 特殊拍摄手法 (specialTechnique): none/hitchcock-zoom/timelapse/crash-zoom-in/crash-zoom-out/whip-pan/bullet-time/fpv-shuttle/macro-closeup/first-person/slow-motion/probe-lens/spinning-tilt
5. 时长 (duration): 秒数，整数
6. 情绪标签 (emotionTags): 1-3个情绪标签ID
7. 出场角色 (characterNames): 完整角色列表，来自原文
8. 环境音 (ambientSound): **中文**，根据场景推断
9. 音效 (soundEffect): **中文**，根据动作推断

**叙事驱动字段（重要！必须基于本集大纲分析）：**
10. 叙事功能 (narrativeFunction): 铺垫/升级/高潮/转折/过渡/尾声
11. 镜头目的 (shotPurpose): 为什么用这个镜头？一句话说明
12. 视觉焦点 (visualFocus): 观众应该按什么顺序看？用箭头表示
13. 机位描述 (cameraPosition): 摄影机相对于人物的位置
14. 人物布局 (characterBlocking): 人物在画面中的位置关系
15. 节奏描述 (rhythm): 这个镜头的节奏感

**拍摄控制字段（Cinematography Controls）：**
16. 灯光风格 (lightingStyle): natural/high-key/low-key/silhouette/chiaroscuro/neon
17. 灯光方向 (lightingDirection): front/side/back/top/bottom/rim
18. 色温 (colorTemperature): warm-3200K/neutral-5600K/cool-7500K/mixed/golden-hour/blue-hour
19. 灯光备注 (lightingNotes): 自由文本，中文，补充灯光细节
20. 景深 (depthOfField): shallow/medium/deep/split-diopter
21. 焦点目标 (focusTarget): 自由文本，中文，描述对焦主体
22. 焦点变化 (focusTransition): none/rack-focus/pull-focus/follow-focus
23. 摄影器材 (cameraRig): tripod/handheld/steadicam/dolly/crane/drone/gimbal/shoulder
24. 运动速度 (movementSpeed): static/slow/normal/fast/whip
25. 大气效果 (atmosphericEffects): 数组，可多选，如 ["雾气","烟尘"] 等天气/环境/艺术效果
26. 效果强度 (effectIntensity): subtle/moderate/heavy
27. 播放速度 (playbackSpeed): slow-0.25x/slow-0.5x/normal/fast-1.5x/fast-2x/timelapse
28. 拍摄角度 (cameraAngle): eye-level/low-angle/high-angle/birds-eye/worms-eye/dutch-angle/over-shoulder/pov/aerial
29. 镜头焦距 (focalLength): 14mm/18mm/24mm/28mm/35mm/50mm/85mm/100mm-macro/135mm/200mm
30. 摄影技法 (photographyTechnique): long-exposure/double-exposure/high-speed/timelapse-photo/tilt-shift/silhouette/reflection/bokeh（如不需要特殊技法可留空）

【三层提示词系统 - 重要】

【16. 首帧提示词 (imagePrompt/imagePromptZh): 用于 AI 图像生成，描述视频第一帧的完整静态画面
    **必须包含以下所有元素**（缺一不可）：
    
    a) **场景环境**：
       - 地点类型（家庭餐厅/办公室/街道等）
       - 环境细节（窗外景色、室内陈设、道具布置）
       - 时间氛围（白天/傍晚/夜晚、季节感）
    
    b) **光线设计**：
       - 光源类型（自然光/灯光/混合光）
       - 光线质感（柔和/硬朗/漫射）
       - 光影氛围（温暖/冷色调/明暗对比）
    
    c) **人物描述**（每个出场人物都要写）：
       - 年龄段（青年/中年/老年）
       - 服装概述（休闲装/正装/工作服等）
       - 表情神态（紧张/严肃/微笑/担忧）
       - 姿势动作（坐着/站立/俯身/手持物品）
    
    d) **构图与景别**：
       - 景别描述（中景三人入画/近景半身/特写面部）
       - 人物位置关系（左中右布局、前后关系）
       - 视觉焦点（主体在画面何处）
    
    e) **重要道具**：
       - 剧情关键道具（证书、物品、食物等）
       - 道具状态（手持/放置/展示）
    
    f) **画面风格**：
       - 电影感/写实风格/剧情照质感
       - 色调倾向（温暖/冷色/自然）
    
    - imagePromptZh: 纯中文，60-100字，包含以上所有元素
    - imagePrompt: 纯英文，60-80词，对应中文内容的完整翻译，适合AI图像模型

11. 视频提示词 (videoPrompt/videoPromptZh): 描述视频中的动态内容
    - **必须强调动作**（如"反复观看"、"紧张地吃饭"等动词）
    - 画面动作（人物动作、物体移动）
    - 镜头运动描述
    - 对白提示（如有）
    - videoPromptZh: 纯中文
    - videoPrompt: 纯英文

【18. 尾帧提示词 (endFramePrompt/endFramePromptZh): 用于 AI 图像生成，描述视频最后一帧的完整静态画面
    
    **与首帧同等重要！必须包含以下所有元素**（缺一不可）：
    
    a) **场景环境**：保持与首帧一致的场景，但反映变化后的状态
    
    b) **光线设计**：与首帧保持一致（除非剧情有时间变化）
    
    c) **人物描述**（重点！描述动作完成后的状态）：
       - 同样包含年龄、服装
       - **新的表情神态**（动作完成后的情绪）
       - **新的姿势位置**（动作完成后的位置）
       - 道具的新状态
    
    d) **构图与景别**：
       - 如有镜头运动，描述运动结束后的新景别
       - 人物新的位置关系
    
    e) **变化对比**（核心！）：
       - 明确描述与首帧的差异（位置/动作/表情/道具状态）
    
    f) **画面风格**：与首帧保持一致
    
    - endFramePromptZh: 纯中文，60-100字，包含以上所有元素
    - endFramePrompt: 纯英文，60-80词，对应中文内容的完整翻译

19. 是否需要尾帧 (needsEndFrame):
    **必须设置为 true**：
    - 人物位置变化（走动、起身、坐下等）
    - 动作序列（拿起物品、放下东西等）
    - 状态变化（门打开/关闭、物品移动等）
    - 镜头运动（非Static）
    - 物品状态变化（翻页、收起等）
    
    **可以设置为 false**：
    - 纯对白（位置不变）
    - 仅表情微小变化
    - 完全静态镜头
    
    **不确定时设为 true**（宁可多生成不要遗漏）

【情绪标签选项】
基础情绪: happy, sad, angry, surprised, fearful, calm
氛围情绪: tense, excited, mysterious, romantic, funny, touching
语气情绪: serious, relaxed, playful, gentle, passionate, low

【风格要求】
${styleDesc}
${cinematographyGuidance ? `
${cinematographyGuidance}
` : ''}
${(() => {
  const mt = getMediaType(styleId || 'cinematic');
  return mt !== 'cinematic' ? `
【媒介类型约束】
${getMediaTypeGuidance(mt)}
` : '';
})()}
镜头设计原则：
- 情感对白、内心活动: CU/ECU 近景特写
- 动作场面、追逐: MS/WS + Tracking跟随
- 场景建立、过渡: WS/FS 远景
- 紧张对峙: 快速切换景别
- 重要物件/细节: ECU特写

**重要：中英文字段必须严格分离！**
- visualDescription, ambientSound, soundEffect, imagePromptZh, videoPromptZh, endFramePromptZh → **必须是纯中文**
- visualPrompt, imagePrompt, videoPrompt, endFramePrompt → **必须是纯英文**

请以JSON格式返回，格式为:
{
  "shots": {
    "shot_id_1": {
      "visualDescription": "窗外栩子花绽放，餐桌旁，张明神情紧张地与父母吃饭，父亲手持985研究生毕业证书反复观看。",
      "visualPrompt": "Gardenias blooming outside window, at dining table Zhang Ming eating nervously with parents, father holding graduate certificate examining it repeatedly",
      "shotSize": "MS",
      "cameraMovement": "static",
      "specialTechnique": "none",
      "duration": 5,
      "emotionTags": ["tense", "serious"],
      "characterNames": ["张明", "张父", "张母"],
      "ambientSound": "餐厅环境音，碗筷轻碰声",
      "soundEffect": "",
      "narrativeFunction": "铺垫",
      "shotPurpose": "建立家庭表面和谐但暗藏张力的氛围，用毕业证书暗示父亲对儿子的期望",
      "visualFocus": "窗外栀子花 → 张明紧张的脸 → 父亲手中的证书",
      "cameraPosition": "张明侧后方45°，可见三人关系",
      "characterBlocking": "张明(中) vs 父母(两侧)，形成包围感",
      "rhythm": "缓慢、压抑，营造表面平静下的紧张感",
      "lightingStyle": "natural",
      "lightingDirection": "side",
      "colorTemperature": "warm-3200K",
      "lightingNotes": "午后侧光透过窗户，形成温暖但带有压迫感的明暗对比",
      "depthOfField": "medium",
      "focusTarget": "张明紧张的面部表情",
      "focusTransition": "rack-focus",
      "cameraRig": "tripod",
      "movementSpeed": "static",
      "atmosphericEffects": ["自然光斑"],
      "effectIntensity": "subtle",
      "playbackSpeed": "normal",
      "cameraAngle": "eye-level",
      "focalLength": "50mm",
      "photographyTechnique": "",
      "imagePrompt": "Cinematic medium shot, modern Chinese family dining room, warm afternoon sunlight through window with blooming gardenias outside, young man Zhang Ming (25, casual clothes, tense expression) sitting at dining table with his middle-aged parents, father (50s, stern face, holding graduate certificate examining it), mother (50s, worried look) beside them, wooden dining table with home-cooked dishes, warm color tones, realistic film style",
      "imagePromptZh": "电影感中景，现代中式家庭餐厅，午后温暖阳光透过窗户洒入，窗外栩子花盛开。青年张明（25岁，休闲装，神情紧张）坐在餐桌旁，中年父亲（50多岁，严肃表情，手持985研究生毕业证书反复查看），母亲（50多岁，担忧神情）坐在旁边。木质餐桌上摆着家常菜肴，温暖色调，写实电影风格。",
      "videoPrompt": "Father repeatedly examining graduate certificate with focused attention, Zhang Ming eating nervously with chopsticks, occasionally glancing at father, mother sitting beside watching silently with worried expression",
      "videoPromptZh": "父亲专注地反复观看毕业证书，张明用筷子紧张地吃饭，不时偷瞄父亲，母亲坐在旁边默默看着，神情担忧。",
      "needsEndFrame": true,
      "endFramePrompt": "Cinematic medium shot, same modern Chinese family dining room, warm afternoon light. Father (50s) now lowering the certificate with satisfied yet stern expression, Zhang Ming (25) stopped eating and looking down nervously, mother (50s) glancing between husband and son with concern. Certificate now placed on table beside dishes, tense atmosphere, warm color tones, realistic film style",
      "endFramePromptZh": "电影感中景，同样的现代中式家庭餐厅，午后温暖光线。父亲（50多岁）已放下证书，表情满意但仍严肃；张明（25岁）停下筷子，低头神情紧张；母亲（50多岁）目光在父子之间游移，神情担忧。证书已放在餐桌上菜肴旁边，气氛紧张，温暖色调，写实电影风格。"
    }
  }
}

**特别注意**：
- 栩子花 = gardenias（不是 peonies）
- visualDescription 必须是中文，不要写英文
- ambientSound/soundEffect 必须是中文`
  
  const shotDescriptions = shots.map(shot => {
    const chars = shot.characterNames?.join('、') || '无';
    // 检测是否包含闪回/叠画内容
    const sourceText = shot.sourceText || shot.actionSummary || '';
    const hasFlashback = /闪回|叠画|回忆|穿插/.test(sourceText);
    const flashbackNote = hasFlashback 
      ? `\n⚠️ 注意：原文包含闪回/叠画内容，但主场景仍然是「${shot.sceneLocation}」，不要描述成另一个场景！`
      : '';
    // 构建场景美术设计信息（如果有）
    const artDesignParts = [
      shot.architectureStyle ? `建筑风格: ${shot.architectureStyle}` : '',
      shot.colorPalette ? `色彩基调: ${shot.colorPalette}` : '',
      shot.eraDetails ? `时代特征: ${shot.eraDetails}` : '',
      shot.lightingDesign ? `光影设计: ${shot.lightingDesign}` : '',
    ].filter(Boolean);
    const artDesignSection = artDesignParts.length > 0 
      ? `\n【🎨 场景美术设计（必须严格遵循）】\n${artDesignParts.join('\n')}` 
      : '';
    return `ID: ${shot.shotId}
【⭐ 主场景（绝对不可更改）】: ${shot.sceneLocation}${flashbackNote}${artDesignSection}
【原始剧本文本】
${sourceText}
【已解析信息】
动作: ${shot.actionSummary}
对白: ${shot.dialogue || '无'}
当前角色: ${chars}
氛围: ${shot.sceneAtmosphere}
时间: ${shot.sceneTime}${shot.sceneWeather ? `
天气: ${shot.sceneWeather}` : ''}
当前景别: ${shot.currentShotSize || '待定'}
当前镜头运动: ${shot.currentCameraMovement || '待定'}`;
  }).join('\n\n═══════════════════════════════════════\n\n');
  
  const userPrompt = `请严格基于每个分镜的【原始剧本文本】生成校准内容。

⚠️ 重要提醒（必须遵守）：
1. **场景归属绝对固定**：每个分镜的【主场景】已经标注，即使原文提到闪回/叠画/回忆，主场景仍不变
2. 不要遗漏原文中的任何关键信息（人物、动作、道具、环境）
3. 不要添加原文中没有的内容
4. **中文字段必须是纯中文**：visualDescription, ambientSound, soundEffect, imagePromptZh, videoPromptZh
5. **英文字段必须是纯英文**：visualPrompt, imagePrompt, videoPrompt, endFramePrompt
6. 角色列表必须完整
7. 栩子花 = gardenias（不是 peonies/peony）

🎬 **叙事驱动分析（基于《电影语言的语法》）**：
- 根据「本集大纲」判断每个镜头在整集故事中的叙事功能
- 镜头设计必须服务于故事的情绪节奏和叙事弧线
- 景别选择要配合叙事功能（铺垫用全景、高潮用特写等）
- 考虑人物布局和机位对故事张力的影响

${shotDescriptions}`;
  
  // 统一从服务映射获取配置（单个分镜校准用更大 token 预算）
  const result = await aiManager.featureText('script_analysis', systemPrompt, userPrompt, { maxTokens: 16384 });
  
  return parseShotCalibrationResponse(result);
}

