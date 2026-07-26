import type { ScriptCharacter } from "@/types/script";


/**
 * 从人物小传文本中提取角色信息
 * 支持两种格式：
 * 1. 紧凑格式：角色名：年龄：XX身份：... （从 Word/微信复制的无换行文本）
 * 2. 标准格式：角色名：描述 或 角色名（年龄）：描述
 */
export function parseCharacterBios(bios: string): ScriptCharacter[] {
  if (!bios || !bios.trim()) return [];
  
  // 检测紧凑格式：角色名：年龄/年两：XX （至少2个条目才认定为紧凑格式）
  const compactEntryRegex = /([\u4e00-\u9fa5]{2,12})[：:]\s*(?:年龄|年两)[：:]\s*(\d{1,3})/g;
  const compactMatches = [...bios.matchAll(compactEntryRegex)];
  
  if (compactMatches.length >= 2) {
    return parseCompactBioFormat(bios, compactMatches);
  }
  
  // 标准格式兜底
  return parseStandardBioFormat(bios);
}

/**
 * 紧凑格式解析：角色名：年龄：XX身份：...关键行为：...
 * 自动剥离段落标记（一、核心主角 等）提取真实角色名
 */
function parseCompactBioFormat(bios: string, matches: RegExpMatchArray[]): ScriptCharacter[] {
  const characters: ScriptCharacter[] = [];
  let index = 1;
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const rawName = match[1];
    const age = match[2];
    
    // 剥离段落关键词提取真实角色名
    const actualName = stripSectionKeywords(rawName);
    if (!actualName || actualName.length < 2 || actualName.length > 8) continue;
    
    // 提取描述：从年龄后到下一个角色条目之前
    const descStart = match.index! + match[0].length;
    const descEnd = i < matches.length - 1 ? matches[i + 1].index! : bios.length;
    let description = bios.slice(descStart, descEnd).trim();
    
    // 移除末尾的段落标记（如 "三、反派势力角色"）
    description = description.replace(/\n?[一二三四五六七八九十\d]+[、.]\s*[\u4e00-\u9fa5]*$/, '').trim();
    
    characters.push({
      id: `char_${index}`,
      name: actualName,
      age,
      role: description.substring(0, 300),
      personality: extractPersonality(description),
      traits: extractTraits(description),
    });
    index++;
  }
  
  console.log(`[parseCharacterBios] 紧凑格式检测到 ${characters.length} 个角色`);
  return characters;
}

/**
 * 从含段落标记的名字中提取真实角色名
 * 如 "核心主角萧惊鸿" → "萧惊鸿"，"正面势力角色赵将军" → "赵将军"
 */
function stripSectionKeywords(name: string): string {
  // 1. 移除开头的中文编号：一、 二. 等
  name = name.replace(/^[一二三四五六七八九十\d]+[、.]\s*/, '');
  // 2. 移除段落类别关键词
  name = name.replace(
    /^(?:核心|主要|正面|反面|反派|次要|重要|关键|群众|正派|其他)(?:势力)?(?:角色|主角|配角|人物)?/,
    ''
  ).trim();
  return name;
}

/**
 * 标准格式解析（原逻辑）：角色名：描述 或 角色名（年龄）：描述
 */
function parseStandardBioFormat(bios: string): ScriptCharacter[] {
  const characters: ScriptCharacter[] = [];
  
  const charRegex = /([^：:\n，,]+?)(?:[（\(](\d+岁?)[）\)])?[：:]\s*([^\n]+(?:\n(?![^：:\n]+[：:])[^\n]+)*)/g;
  const matches = [...bios.matchAll(charRegex)];
  
  let index = 1;
  for (const match of matches) {
    const name = match[1].trim();
    const age = match[2]?.replace('岁', '') || '';
    const description = match[3].trim();
    
    // 跳过非角色内容
    if (name.length > 10 || name.match(/^[第一二三四五六七八九十\d]/)) continue;
    // 跳过属性标签和补充说明
    if (/^(?:年龄|身份|性格|补充|注|备注|核心特质|关键行为)$/.test(name)) continue;
    
    characters.push({
      id: `char_${index}`,
      name,
      age,
      role: description,
      personality: extractPersonality(description),
      traits: extractTraits(description),
    });
    index++;
  }
  
  return characters;
}

/**
 * 从描述中提取性格特点
 */
function extractPersonality(description: string): string {
  // 查找性格相关关键词
  const personalityKeywords = ['性格', '为人', '品性', '脾气'];
  for (const keyword of personalityKeywords) {
    const match = description.match(new RegExp(`${keyword}[^，。,\.]+`));
    if (match) return match[0];
  }
  return '';
}

/**
 * 从描述中提取核心特质
 */
function extractTraits(description: string): string {
  // 查找特质相关关键词
  const traits: string[] = [];
  const traitPatterns = [
    /聪[明慧]/, /坚[韧强]/, /勤[劳奋]/, /憨厚/, /老实/,
    /吃苦耐劳/, /脚踏实地/, /感恩/,
  ];
  
  for (const pattern of traitPatterns) {
    const match = description.match(pattern);
    if (match) traits.push(match[0]);
  }
  
  return traits.join('、');
}

