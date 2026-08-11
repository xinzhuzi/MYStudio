import type { EpisodeRawScript, ScriptCharacter } from "@/types/script";


/**
 * 清理角色名（去除markdown标记和多余符号）
 */
function cleanCharacterName(rawName: string): string {
  let name = rawName.trim();
  // 去除 markdown 加粗标记
  name = name.replace(/\*+/g, '');
  // 去除括号及其内容，如 "王艳（周妻）" -> "王艳"
  name = name.replace(/[（\(][^）\)]*[）\)]?/g, '');
  // 去除单独的右括号（截断情况）
  name = name.replace(/[）\)]/g, '');
  // 去除引号
  name = name.replace(/["“”‘’"']/g, '');
  // 去除 VO/os 后缀
  name = name.replace(/(VO|os)$/i, '');
  // 去除前后空白和标点
  name = name.replace(/^[\s,，、；;：:\u3000]+|[\s,，、；;：:\u3000]+$/g, '');
  return name.trim();
}

/**
 * 拆分多人组合名字，如 "张明、老周" -> ["张明", "老周"]
 */
function splitMultipleCharacters(rawName: string): string[] {
  // 先清理 markdown
  const name = rawName.replace(/\*+/g, '').trim();
  // 按常见分隔符拆分
  const parts = name.split(/[、,，\s]+/).filter(p => p.length > 0);
  return parts;
}

/**
 * 检查是否为有效角色名（放宽过滤，让 AI 做智能校准）
 */
function isValidCharacterName(name: string): boolean {
  // 跳过空名字
  if (!name || name.length < 1) return false;
  // 跳过太长的名字（放宽到6字，让AI判断）
  if (name.length > 6) return false;
  // 跳过纯数字
  if (/^\d+$/.test(name)) return false;
  // 跳过包含特殊符号的
  if (/[\*\-\+\=\>\<\|\[\]\{\}]/.test(name)) return false;
  // 跳过明显的非角色词（只过滤最明显的，其他交给AI）
  const obviousNonCharacters = [
    'VO', '旁白', 'os', '左边', '右边', '中间', '背影', '远处',
    '效率', '回流率', '分拣', '客户', '眼眶', '微湿', '手持', '笔挺',
    '上市文件', '眼神', '声音', '电视', '电话'
  ];
  if (obviousNonCharacters.includes(name)) return false;
  return true;
}

/**
 * 处理单个角色名字并添加到集合
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function processAndAddCharacter(
  rawName: string,
  existingNames: Set<string>,
  newCharacters: ScriptCharacter[],
  index: { value: number },
  role: string
): void {
  // 先拆分多人组合
  const parts = splitMultipleCharacters(rawName);
  
  for (const part of parts) {
    const name = cleanCharacterName(part);
    if (!isValidCharacterName(name)) continue;
    if (existingNames.has(name)) continue;
    
    existingNames.add(name);
    newCharacters.push({
      id: `char_${index.value}`,
      name,
      role,
    });
    index.value++;
  }
}

/**
 * 从所有场景中提取出场角色（补充人物小传中没有的角色）
 */
export function extractCharactersFromScenes(
  episodeScripts: EpisodeRawScript[],
  existingCharacters: ScriptCharacter[]
): ScriptCharacter[] {
  const existingNames = new Set(existingCharacters.map(c => c.name));
  const newCharacters: ScriptCharacter[] = [];
  const index = { value: existingCharacters.length + 1 };
  
  // 统计每个角色的出场次数
  const appearanceCount = new Map<string, number>();
  
  for (const ep of episodeScripts) {
    for (const scene of ep.scenes) {
      // 从场景的 characters 字段提取
      for (const charName of scene.characters) {
        const parts = splitMultipleCharacters(charName);
        for (const part of parts) {
          const name = cleanCharacterName(part);
          if (isValidCharacterName(name)) {
            appearanceCount.set(name, (appearanceCount.get(name) || 0) + 1);
          }
        }
      }
      
      // 从对白中提取说话人
      for (const dialogue of scene.dialogues) {
        const parts = splitMultipleCharacters(dialogue.character);
        for (const part of parts) {
          const name = cleanCharacterName(part);
          if (isValidCharacterName(name)) {
            appearanceCount.set(name, (appearanceCount.get(name) || 0) + 1);
          }
        }
      }
    }
  }
  
  // 按出场次数排序，添加新角色
  const sortedNames = [...appearanceCount.entries()]
    .filter(([name]) => !existingNames.has(name))
    .sort((a, b) => b[1] - a[1]); // 按出场次数降序
  
  for (const [name, count] of sortedNames) {
    existingNames.add(name);
    newCharacters.push({
      id: `char_${index.value}`,
      name,
      role: count > 5 ? `重要配角（出场${count}次）` : `次要角色（出场${count}次）`,
    });
    index.value++;
  }
  
  return newCharacters;
}

