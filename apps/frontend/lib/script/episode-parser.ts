// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Episode Parser - 中文剧本规则解析器
 * 解析标准中文剧本格式，提取集、场景、对白、动作等结构化信息
 * 
 * 支持的格式：
 * - 集标记：第X集
 * - 场景头：**1-1日 内 沪上 张家** 或 1-1 日 内 沪上 张家
 * - 人物行：人物：张明、张父
 * - 字幕：【字幕：2002年夏】
 * - 动作描写：△窗外栀子花绽放...
 * - 对白：张父：（喝酒）我们明明真是太有出息了！
 * - 闪回：【闪回】...【闪回结束】
 * - 旁白/VO：【VO：...】
 */

import type {
  EpisodeRawScript,
  SceneRawContent,
  DialogueLine,
  ProjectBackground,
  ScriptData,
  Episode,
  ScriptScene,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  ScriptCharacter,
} from "@/types/script";
import {
  extractTimelineInfo as extractMetadataTimelineInfo,
  detectGenre as detectMetadataGenre,
  extractWorldSetting as extractMetadataWorldSetting,
  extractThemes as extractMetadataThemes,
} from "./episode-metadata";
import { parseCharacterBios } from "./character-bio-parser";
import { extractCharactersFromScenes } from "./scene-character-extractor";

export { parseCharacterBios } from "./character-bio-parser";

/**
 * 清理场景地点字符串，移除人物信息等无关内容
 * 如 "乡村公路/大巴车 人物：沈星晴、村民" -> "乡村公路/大巴车"
 */
function cleanLocationString(location: string): string {
  if (!location) return '';
  // 移除 "人物：XXX" 部分
  let cleaned = location.replace(/\s*人物[\uff1a:].*/g, '');
  // 移除 "角色：XXX" 部分
  cleaned = cleaned.replace(/\s*角色[\uff1a:].*/g, '');
  // 移除 "时间：XXX" 部分
  cleaned = cleaned.replace(/\s*时间[\uff1a:].*/g, '');
  // 去除首尾空白
  return cleaned.trim();
}

/**
 * 解析完整剧本文本，提取背景信息和各集内容
 */
export function parseFullScript(fullText: string): {
  background: ProjectBackground;
  episodes: EpisodeRawScript[];
} {
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const lines = fullText.split('\n');
  
  // 1. 提取标题
  const titleMatch = fullText.match(/[《「]([^》」]+)[》」]/);
  const title = titleMatch ? titleMatch[1] : '未命名剧本';
  
  // 2. 提取大纲（从"大纲："到"人物小传："之间的内容）
  // 支持 Markdown 格式：**大纲：** 或 大纲： 或 【大纲】
  // 末尾 |$ 兜底：无人物小传/无集标记时匹配到文本末尾
  const outlineMatch = fullText.match(/(?:\*{0,2}大纲[：:]\u200b?\*{0,2}|【大纲】)([\s\S]*?)(?=(?:\*{0,2}人物小传[：:]|【人物|第[一二三四五六七八九十\d]+集|$))/i);
  const outline = outlineMatch ? outlineMatch[1].trim() : '';
  
  // 3. 提取人物小传（从"人物小传："到第一集之前的内容）
  // 支持 Markdown 格式：**人物小传：** 或 人物小传： 或 【人物小传】
  // 末尾 |$ 兜底：无集标记时匹配到文本末尾
  const characterBiosMatch = fullText.match(/(?:\*{0,2}人物小传[：:]\*{0,2}|【人物小传】)([\s\S]*?)(?=\*{0,2}第[一二三四五六七八九十\d]+集|$)/i);
  const characterBios = characterBiosMatch ? characterBiosMatch[1].trim() : '';
  
  // 4. 提取时代背景和时间线设定
  const { era, timelineSetting, storyStartYear, storyEndYear } = extractMetadataTimelineInfo(outline, characterBios);
  
  // 5. 提取类型（genre）
  const genre = detectMetadataGenre(outline, characterBios);
  
  // 6. 提取世界观/风格设定
  const worldSetting = extractMetadataWorldSetting(outline, characterBios);
  
  // 7. 提取主题关键词
  const themes = extractMetadataThemes(outline, characterBios);
  
  // 8. 解析各集内容
  const episodes = parseEpisodes(fullText);
  
  return {
    background: {
      title,
      outline,
      characterBios,
      era,
      timelineSetting,
      storyStartYear,
      storyEndYear,
      genre,
      worldSetting,
      themes,
    },
    episodes,
  };
}

/**
 * Compatibility wrappers for the extracted metadata boundary.
 * Keeping these private names avoids changing legacy internal call sites.
 */
function _extractTimelineInfo(outline: string, characterBios: string) {
  return extractMetadataTimelineInfo(outline, characterBios);
}

function detectGenre(outline: string, characterBios: string) {
  return detectMetadataGenre(outline, characterBios);
}

function _extractWorldSetting(outline: string, characterBios: string) {
  return extractMetadataWorldSetting(outline, characterBios);
}

function _extractThemes(outline: string, characterBios: string) {
  return extractMetadataThemes(outline, characterBios);
}

/**
 * 解析各集剧本
 */
export function parseEpisodes(text: string): EpisodeRawScript[] {
  const episodes: EpisodeRawScript[] = [];
  
  // 匹配集标记：第X集 或 第X集：标题
  // 支持 **第X集** 或 **第X集：标题** 格式
  const episodeRegex = /\*{0,2}第([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\d]+)集[\uff1a:]?\s*([^\n\*]*?)\*{0,2}(?=\n|$)/g;
  const matches = [...text.matchAll(episodeRegex)];
  
  if (matches.length === 0) {
    // 如果没有找到集标记，把整个文本当作第一集
    const scenes = parseScenes(text);
    return [{
      episodeIndex: 1,
      title: '第一集',
      rawContent: text,
      scenes,
      shotGenerationStatus: 'idle',
    }];
  }
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const episodeIndex = chineseToNumber(match[1]);
    // 清理标题：移除前后空格和 ** 符号
    const rawTitle = match[2]?.trim().replace(/^\*+|\*+$/g, '').trim() || '';
    // 确保标题包含集号
    const episodeTitle = rawTitle 
      ? `第${episodeIndex}集：${rawTitle}` 
      : `第${episodeIndex}集`;
    
    // 获取本集内容（从当前集到下一集之间）
    const startIndex = match.index! + match[0].length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const rawContent = text.slice(startIndex, endIndex).trim();
    
    // 解析场景
    const scenes = parseScenes(rawContent);
    
    // 从字幕中提取季节
    const season = extractSeasonFromScenes(scenes);
    
    episodes.push({
      episodeIndex,
      title: episodeTitle,
      rawContent,
      scenes,
      shotGenerationStatus: 'idle',
      season,
    });
  }
  
  return episodes;
}

/**
 * 解析单集内的场景
 */
export function parseScenes(episodeText: string): SceneRawContent[] {
  const scenes: SceneRawContent[] = [];
  
  // 场景头格式匹配：
  // **1-1日 内 沪上 张家** 或
  // 1-1 日 内 沪上 张家 或
  // **2-3 夜 外 码头**
  const sceneHeaderRegex = /\*{0,2}(\d+-\d+)\s*(日|夜|晨|暮|黄昏|黎明|清晨|傍晚)\s*(内|外|内\/外)\s+([^\*\n]+)\*{0,2}/g;
  const sceneMatches = [...episodeText.matchAll(sceneHeaderRegex)];
  
  if (sceneMatches.length === 0) {
    // 没有找到标准场景头，尝试宽松的 数字-数字 格式
    // 匹配如：1-1 规则怪谈世界，集合广场，日  或  1-2 全球同一会议直播间，日
    const looseSceneRegex = /^\*{0,2}(\d+-\d+)\s+([^\*\n]+)\*{0,2}$/gm;
    const looseMatches = [...episodeText.matchAll(looseSceneRegex)];
    
    if (looseMatches.length > 0) {
      for (let i = 0; i < looseMatches.length; i++) {
        const match = looseMatches[i];
        const sceneNumber = match[1]; // 如 "1-1"
        const rawDesc = match[2].replace(/\*{1,2}/g, '').trim(); // 如 "规则怪谈世界，集合广场，日"
        
        // 从描述中智能提取时间（日/夜/晨/暮等），通常在末尾
        const timeWords = ['日', '夜', '晨', '暮', '黄昏', '黎明', '清晨', '傍晚'];
        let timeOfDay = '日'; // 默认值
        let locationDesc = rawDesc;
        
        // 检查描述末尾是否以时间词结尾（可能用逗号、空格分隔）
        for (const tw of timeWords) {
          const endPattern = new RegExp(`[，,\\s]${tw}\\s*$`);
          if (endPattern.test(rawDesc)) {
            timeOfDay = tw;
            locationDesc = rawDesc.replace(endPattern, '').trim();
            break;
          }
          // 也处理整个描述就是时间词的情况
          if (rawDesc === tw) {
            timeOfDay = tw;
            locationDesc = '未知地点';
            break;
          }
        }
        
        // 尝试从描述中提取 内/外 标记
        let interior = '';
        const interiorMatch = locationDesc.match(/[，,\s](内|外|内\/外)\s*/);
        if (interiorMatch) {
          interior = interiorMatch[1];
          locationDesc = locationDesc.replace(interiorMatch[0], '').trim();
        }
        
        // 将中文逗号分隔的地点拼接成可读格式
        const location = locationDesc.replace(/[，,]/g, ' ').replace(/\s+/g, ' ').trim() || '未知地点';
        
        // 构建标准格式的场景头，供下游代码使用
        const sceneHeader = interior 
          ? `${sceneNumber} ${timeOfDay} ${interior} ${location}`
          : `${sceneNumber} ${timeOfDay} ${location}`;
        
        // 获取场景内容
        const startIndex = match.index! + match[0].length;
        const endIndex = i < looseMatches.length - 1 ? looseMatches[i + 1].index! : episodeText.length;
        const content = episodeText.slice(startIndex, endIndex).trim();
        
        const tokens = parseSceneTokens(content);
        
        scenes.push({
          sceneHeader,
          ...tokens,
          content,
          timeOfDay,
        });
      }
      return scenes;
    }
    
    // 宽松格式也没匹配到，尝试其他备用格式
    return parseAlternativeSceneFormat(episodeText);
  }
  
  for (let i = 0; i < sceneMatches.length; i++) {
    const match = sceneMatches[i];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sceneHeader = match[0].replace(/\*{1,2}/g, '').trim();
    const sceneNumber = match[1]; // 如 "1-1"
    const timeOfDay = match[2];   // 如 "日"、"夜"
    const interior = match[3];    // 如 "内"、"外"
    const location = match[4]?.trim() || '未知地点';
    
    // 获取场景内容（从当前场景头到下一个场景头之间）
    const startIndex = match.index! + match[0].length;
    const endIndex = i < sceneMatches.length - 1 ? sceneMatches[i + 1].index! : episodeText.length;
    const content = episodeText.slice(startIndex, endIndex).trim();
    
    const tokens = parseSceneTokens(content);
    
    scenes.push({
      sceneHeader: `${sceneNumber} ${timeOfDay} ${interior} ${location}`,
      ...tokens,
      content,
      timeOfDay,
    });
  }
  
  return scenes;
}

/**
 * 解析备用场景格式（当标准格式不匹配时）
 */
function parseAlternativeSceneFormat(text: string): SceneRawContent[] {
  const scenes: SceneRawContent[] = [];
  
  // 尝试匹配其他常见格式
  // 格式1: 场景X 或 场景 X
  // 格式2: [场景描述]
  // 格式3: 直接按段落分
  
  const altRegex = /(?:场景\s*(\d+)|【场景[：:]?\s*([^\】]+)】)/g;
  const matches = [...text.matchAll(altRegex)];
  
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const startIndex = match.index! + match[0].length;
      const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
      const content = text.slice(startIndex, endIndex).trim();
      
      scenes.push({
        sceneHeader: match[0].replace(/[【】]/g, ''),
        ...parseSceneTokens(content, false),
        content,
      });
    }
  } else {
    // 作为单一场景处理
    scenes.push({
      sceneHeader: '主场景',
      ...parseSceneTokens(text, false),
      content: text,
    });
  }
  
  return scenes;
}

/** Parse the common content tokens shared by each scene-header format. */
function parseSceneTokens(content: string, includeWeather = true): Pick<SceneRawContent, 'characters' | 'dialogues' | 'actions' | 'subtitles'> & Partial<Pick<SceneRawContent, 'weather'>> {
  const characters = parseCharacters(content);
  const dialogues = parseDialogues(content);
  const actions = parseActions(content);
  const subtitles = parseSubtitles(content);

  return includeWeather
    ? { characters, dialogues, actions, subtitles, weather: detectWeather(content, actions) }
    : { characters, dialogues, actions, subtitles };
}

/**
 * 从场景内容和动作描写中检测天气
 */
function detectWeather(content: string, actions: string[]): string | undefined {
  const fullText = `${content} ${actions.join(' ')}`;
  
  // 天气关键词检测（通用，不硬编码具体场景）
  if (/暴雨|大雨|倾盆大雨/.test(fullText)) return '暴雨';
  if (/小雨|细雨|毛毛雨|淆淆沉沉/.test(fullText)) return '小雨';
  if (/雨|淅沥|润湿/.test(fullText)) return '雨';
  if (/暴风雪|鹞毛大雪/.test(fullText)) return '暴雪';
  if (/雪|飘雪|雪花/.test(fullText)) return '雪';
  if (/大雾|浓雾/.test(fullText)) return '大雾';
  if (/雾|薄雾|雾气/.test(fullText)) return '雾';
  if (/狂风|阵风|暴风/.test(fullText)) return '狂风';
  if (/风|微风|清风/.test(fullText)) return '微风';
  if (/阴天|乌云|阴沉沉/.test(fullText)) return '阴';
  if (/晴朗|艳阳|日光明媚|万里无云/.test(fullText)) return '晴';
  if (/电闪雷鸣|打雷|闪电/.test(fullText)) return '雷雨';
  
  return undefined; // 未检测到特定天气
}

/**
 * 从场景字幕中提取季节
 */
function extractSeasonFromScenes(scenes: SceneRawContent[]): string | undefined {
  for (const scene of scenes) {
    for (const subtitle of scene.subtitles) {
      // 匹配字幕中的季节信息，如【字幕：2002年夏】
      const seasonMatch = subtitle.match(/(春天?|夏天?|秋天?|冬天?|初春|仲夏|深秋|隆冬|盛夏|暖春|寒冬)/);
      if (seasonMatch) {
        const s = seasonMatch[1];
        if (s.includes('春')) return '春';
        if (s.includes('夏')) return '夏';
        if (s.includes('秋')) return '秋';
        if (s.includes('冬')) return '冬';
      }
    }
  }
  return undefined;
}

/**
 * 解析场景中的人物
 */
function parseCharacters(text: string): string[] {
  const characters: Set<string> = new Set();
  
  // 1. 从"人物："行提取
  const charLineMatch = text.match(/人物[：:]\s*([^\n]+)/);
  if (charLineMatch) {
    const charList = charLineMatch[1].split(/[、,，]/);
    charList.forEach(c => {
      const name = c.trim();
      if (name) characters.add(name);
    });
  }
  
  // 2. 从对白中提取说话人
  const dialogueRegex = /^([^：:（\(【\n]{1,10})[：:](?:\s*[（\(][^）\)]+[）\)])?/gm;
  const dialogueMatches = [...text.matchAll(dialogueRegex)];
  dialogueMatches.forEach(m => {
    const name = m[1].trim();
    // 过滤掉非人名的内容
    if (name && !name.match(/^[△【字幕旁白VO场景]/)) {
      characters.add(name);
    }
  });
  
  return Array.from(characters);
}

/**
 * 解析对白
 */
function parseDialogues(text: string): DialogueLine[] {
  const dialogues: DialogueLine[] = [];
  
  // 对白格式：角色名：（动作）台词
  // 或：角色名：台词
  const dialogueRegex = /^([^：:（\(【\n△]{1,10})[：:]\s*(?:[（\(]([^）\)]+)[）\)])?\s*(.+)$/gm;
  
  const matches = [...text.matchAll(dialogueRegex)];
  
  for (const match of matches) {
    const character = match[1].trim();
    const parenthetical = match[2]?.trim();
    const line = match[3]?.trim();
    
    // 过滤掉非对白内容
    if (character && line && !character.match(/^[字幕旁白场景人物]/)) {
      dialogues.push({
        character,
        parenthetical,
        line,
      });
    }
  }
  
  return dialogues;
}

/**
 * 解析动作描写（△开头的行）
 */
function parseActions(text: string): string[] {
  const actions: string[] = [];
  
  // △开头的动作描写
  const actionRegex = /^△(.+)$/gm;
  const matches = [...text.matchAll(actionRegex)];
  
  matches.forEach(m => {
    const action = m[1].trim();
    if (action) actions.push(action);
  });
  
  return actions;
}

/**
 * 解析字幕（【字幕：...】或【VO：...】等）
 */
function parseSubtitles(text: string): string[] {
  const subtitles: string[] = [];
  
  // 【字幕：...】或【VO：...】或【闪回】等
  const subtitleRegex = /【([^】]+)】/g;
  const matches = [...text.matchAll(subtitleRegex)];
  
  matches.forEach(m => {
    subtitles.push(m[1]);
  });
  
  return subtitles;
}

/**
 * 中文数字转阿拉伯数字
 */
function chineseToNumber(chinese: string): number {
  // 如果已经是数字
  if (/^\d+$/.test(chinese)) {
    return parseInt(chinese, 10);
  }
  
  const chineseNums: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100, '千': 1000,
  };
  
  let result = 0;
  let temp = 0;
  let prevUnit = 1;
  
  for (const char of chinese) {
    const num = chineseNums[char];
    if (num === undefined) continue;
    
    if (num >= 10) {
      // 是单位（十、百、千）
      if (temp === 0) temp = 1;
      result += temp * num;
      temp = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
      prevUnit = num;
    } else {
      temp = num;
    }
  }
  
  result += temp;
  return result || 1;
}

/**
 * 将解析后的剧本转换为 ScriptData 格式（用于系统显示）
 */
export function convertToScriptData(
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[]
): ScriptData {
  // 1. 从人物小传提取主要角色
  const mainCharacters = parseCharacterBios(background.characterBios);
  
  // 2. 从场景中补充其他角色
  const additionalCharacters = extractCharactersFromScenes(episodeScripts, mainCharacters);
  
  // 3. 合并角色列表（人物小传的角色排在前面）
  const characters = [...mainCharacters, ...additionalCharacters];
  
  
  const episodes: Episode[] = [];
  const scenes: ScriptScene[] = [];
  
  let sceneIndex = 1;
  
  for (const ep of episodeScripts) {
    const episodeId = `ep_${ep.episodeIndex}`;
    const sceneIds: string[] = [];
    
    for (const scene of ep.scenes) {
      const sceneId = `scene_${sceneIndex}`;
      sceneIds.push(sceneId);
      
      // 解析场景头获取时间和地点
      // 支持两种格式：
      // 标准格式: "1-1 日 内 地点名" (headerParts: [number, time, interior, ...location])
      // 宽松格式: "1-1 日 地点名" (headerParts: [number, time, ...location])
      const headerParts = scene.sceneHeader.split(/\s+/);
      const timeOfDay = headerParts[1] || '日';
      const hasInterior = headerParts[2] && /^(内|外|内\/外)$/.test(headerParts[2]);
      const locationStartIndex = hasInterior ? 3 : 2;
      const rawLocation = headerParts.slice(locationStartIndex).join(' ') || headerParts[headerParts.length - 1] || '未知';
      
      // 清理 location，移除人物信息等无关内容
      const location = cleanLocationString(rawLocation);
      
      scenes.push({
        id: sceneId,
        name: `${ep.episodeIndex}-${sceneIndex} ${location}`,
        location: location,
        time: normalizeTime(timeOfDay),
        atmosphere: detectAtmosphere(scene.content),
      });
      
      sceneIndex++;
    }
    
    episodes.push({
      id: episodeId,
      index: ep.episodeIndex,
      title: ep.title,
      description: extractEpisodeDescription(ep.rawContent),
      sceneIds,
    });
  }
  
  return {
    title: background.title,
    genre: detectGenre(background.outline, background.characterBios),
    logline: extractLogline(background.outline),
    language: '中文',
    characters,
    episodes,
    scenes,
    storyParagraphs: [],
  };
}

/**
 * 标准化时间
 */
function normalizeTime(time: string): string {
  const timeMap: Record<string, string> = {
    '日': 'day',
    '夜': 'night',
    '晨': 'dawn',
    '暮': 'dusk',
    '黄昏': 'dusk',
    '黎明': 'dawn',
    '清晨': 'dawn',
    '傍晚': 'dusk',
  };
  return timeMap[time] || 'day';
}

/**
 * 检测场景氛围
 */
function detectAtmosphere(content: string): string {
  if (content.match(/紧张|危险|冲突|打斗|怒/)) return '紧张';
  if (content.match(/温馨|幸福|笑|欢/)) return '温馨';
  if (content.match(/悲伤|哭|痛|泪/)) return '悲伤';
  if (content.match(/神秘|阴森|黑暗/)) return '神秘';
  return '平静';
}

// detectGenre 已移至文件顶部，支持完整的类型检测

/**
 * 提取剧本概述
 */
function extractLogline(outline: string): string {
  // 取大纲的第一句话作为概述
  const firstSentence = outline.match(/^[^。！？\n]+[。！？]/);
  return firstSentence ? firstSentence[0] : outline.slice(0, 100);
}

/**
 * 提取集概述
 */
function extractEpisodeDescription(content: string): string {
  // 取前100个字符作为概述
  return content.replace(/\*{1,2}/g, '').slice(0, 100).trim() + '...';
}
