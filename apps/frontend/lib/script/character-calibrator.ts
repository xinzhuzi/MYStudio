import type { CalibrationStrictness, EpisodeRawScript, FilteredCharacterRecord, ProjectBackground, PromptLanguage, ScriptCharacter } from "@/types/script";
import { processBatched } from "@/lib/ai/batch-processor";
import { estimateTokens, safeTruncate } from "@/lib/ai/model-registry";
import { useScriptStore } from "@/stores/script/script-store";
import { buildSeriesContextSummary } from "./series-meta-sync";
import { buildCharacterPriorityRecords, collectCharacterStats } from "./character-calibrator-utils";
import { CalibratedCharacter } from "./character-calibrator-normalizers";
import { enrichCharactersWithVisualPrompts } from "./character-calibrator-enrich";


// ==================== 类型定义 ====================

export interface CharacterCalibrationResult {
  /** 校准后的角色列表 */
  characters: CalibratedCharacter[];
  /** 被过滤的词（非角色） */
  filteredWords: string[];
  /** 被过滤的角色（带原因，用于用户确认/恢复） */
  filteredCharacters: FilteredCharacterRecord[];
  /** 合并记录（哪些被合并到一起） */
  mergeRecords: MergeRecord[];
  /** AI 分析说明 */
  analysisNotes: string;
}

export interface MergeRecord {
  /** 最终使用的名字 */
  finalName: string;
  /** 被合并的变体 */
  variants: string[];
  /** 合并原因 */
  reason: string;
}

export interface CalibrationOptions {
  /** 上次校准的角色列表，用于合并确保角色不丢失 */
  previousCharacters?: CalibratedCharacter[];
  /** 提示词语言选项 */
  promptLanguage?: PromptLanguage;
  /** 校准严格度 */
  strictness?: CalibrationStrictness;
}

// ==================== 核心函数 ====================

/**
 * 使用 AI 校准角色列表
 * 
 * @param rawCharacters 原始提取的角色列表
 * @param background 项目背景（大纲）
 * @param episodeScripts 分集剧本（提供上下文）
 * @param options API 配置
 */
export { collectCharacterStats, extractAllCharactersFromEpisodes } from './character-calibrator-utils';
export type { CharacterStats } from './character-calibrator-utils';
export { convertToScriptCharacters, resolveSafeScriptCharacters, sortByImportance } from './character-calibrator-normalizers';
export type { CalibratedCharacter } from './character-calibrator-normalizers';

export async function calibrateCharacters(
  rawCharacters: ScriptCharacter[],
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  options?: CalibrationOptions
): Promise<CharacterCalibrationResult> {
  const previousCharacters = options?.previousCharacters;
  const promptLanguage = options?.promptLanguage || 'zh+en';
  const strictness = options?.strictness || 'normal';
  
  // 1. 先统计每个角色的出场情况
  const characterNames = rawCharacters.map(c => c.name);
  const stats = collectCharacterStats(characterNames, episodeScripts);
  
  // 2. 构建带统计信息的角色列表，按智能优先级排序
  const priorityStats = new Map(Array.from(stats.entries()).map(([name, value]) => [name, {
    sceneCount: value.sceneCount,
    dialogueCount: value.dialogueCount,
    episodeCount: value.episodes.length,
  }]));
  const charsWithStats = buildCharacterPriorityRecords(
    rawCharacters.map((character) => character.name), priorityStats, strictness,
  );
  
  // 限制发送给 AI 的角色数量，避免输出截断
  // 优先保留有名字的角色
  const maxCharsToSend = 150;
  const charsToProcess = charsWithStats.slice(0, maxCharsToSend);
 
  
  // 3. 准备批处理 items（每个角色带上统计信息和对白样本）
  const batchItems = charsToProcess.map(c => ({
    name: c.name,
    sceneCount: c.sceneCount,
    dialogueCount: c.dialogueCount,
    episodeCount: c.episodeCount,
    dialogueSamples: stats.get(c.name)?.dialogueSamples || [],
  }));
  
  // 计算总场次数用于判断核心主角的 10% 阈值
  let totalSceneCount = 0;
  for (const ep of episodeScripts) {
    if (ep?.scenes) totalSceneCount += ep.scenes.length;
  }
  const coreThreshold = Math.max(Math.floor(totalSceneCount * 0.1), 10);
  
  // === 根据严格度生成不同的筛选指令段 ===
  const strictnessInstructions = strictness === 'strict'
    ? `【筛选模式：严格】
- 只保留明确的主角、重要配角、和有具体名字的次要角色
- 出场 ≤1 且无对白的角色过滤
- 纯称呼没有具体名字的角色过滤（如"学习委员"、"戴眼镜的男生"）
- 群演全部过滤`
    : strictness === 'loose'
    ? `【筛选模式：宽松】
- 几乎不过滤，保留所有能识别的角色
- 包括群演、低频角色、只有称呼的角色（如"学习委员"、"戴眼镜的男生"）
- 只过滤纯描述词（如"眼框微湿"、"干练优雅"）和非人物词（如"全体员工"、"核心团队"）`
    : `【筛选模式：标准】
- 有名字或称呼的角色全部保留
- 只过滤纯群演、群体、非角色词`;
  
  // 注入剧级上下文
  const store = useScriptStore.getState();
  const activeProjectId = store.activeProjectId;
  const seriesMeta = activeProjectId ? store.projects[activeProjectId]?.seriesMeta : null;
  const seriesCtx = buildSeriesContextSummary(seriesMeta || null);
  const seriesCtxBlock = seriesCtx ? `\n\n${seriesCtx}\n` : '';

  const systemPrompt = `你是专业的影视剧本分析师，擅长从剧本数据中识别和校准角色。${seriesCtxBlock}
【核心目标】
校准后的角色列表将用于生成角色三视图。

${strictnessInstructions}

【严格执行 - 保留规则】

**1. 核心主角 (protagonist)** - 必须保留
   - 名字明确，出场多，贯穿全剧
   - 例：张明、老周、苏晴

**2. 重要配角 (supporting)** - 必须保留
   - 有具体名字或昵称：刀疑哥、龙哥、李强、王艳、小乐、阿强
   - 有固定称呼：赖董、王总、周总、李医生
   - 出场 ≥1 且有对白、或出场 ≥2

**3. 次要角色 (minor)** - 必须保留
   - 有具体名字，偶尔出场
   - 对剧情有一定作用
   - **只出场1次但有名字的也要保留！**

**4. 群演/配角 (extra)** - ${strictness === 'strict' ? '可以过滤' : strictness === 'loose' ? '必须保留' : '尽量保留'}
   - 有称呼但出场极少的，标记为 extra
   - 例：李老头、小刘、王大妈

${strictness !== 'strict' ? `【极其重要 - 宽松筛选原则】
- **有名字的全部保留！**（即使只出场1次）
- **有称呼的全部保留！**（如老X、小X、X哥、X姐、X总、X董）
- **不确定的保留！**（宁可多保留，不要遗漏）
` : ''}【过滤规则】

**必须过滤的（无名字的纯群演）：**
- 纯职业词：保安、警察、护士、医生、记者、员工、律师、服务员、司机
- 数字编号：保安1、警察2、护士3、员工A
- 群体词：若干人、众人、几名保安、两个大妈、一群人
- 非角色词：全体员工、保安部、核心团队
- 描述词：眼框微湿、干练优雅、眼神沉静

**绝对不能过滤的：**
- 任何有姓名的：张明、李强、王艳、林风、马克
- 任何有昵称的：刀疑哥、龙哥、小乐、阿强、老李、小刘
- 有姓氏+职业：赖董、王总、周总、李医生、张秘书、林师傅
- 有姓氏+称谓：李老头、王大妈、周妹

【合并规则】
只合并明确是同一人的不同称呼：
- 例："王总" 和 "投资人王总" → 合并为 "王总"
- 例："刀疑哥" 和 "李强" 如果剧情明确是同一人 → 合并

【数量约束】
- 主角：1-3 个
- 配角：5-30 个（有名字的全部保留，不要限制）
- 总角色数：建议 15-40 个，宁多勿少

【重要】每个被过滤的角色请在 filteredCharacters 中说明过滤原因。

请以JSON格式返回分析结果。`;

  // 共享的背景上下文（每批都带，用 safeTruncate 截断）
  const outlineContext = safeTruncate(background.outline || '', 1500);
  const biosContext = safeTruncate(background.characterBios || '', 1000);

  // === 第一步：AI 角色分析（自动分批）===
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    
    // 闭包收集跨批次的聚合字段
    const allFilteredWords: string[] = [];
    const allFilteredCharacters: FilteredCharacterRecord[] = [];
    const allMergeRecords: MergeRecord[] = [];
    const allAnalysisNotes: string[] = [];
    
    const { results: charResults, failedBatches } = await processBatched<
      typeof batchItems[number],
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >({
      items: batchItems,
      feature: 'script_analysis',
      buildPrompts: (batch) => {
        // 每批构建独立的角色列表和对白样本
        const charList = batch.map((c, i) => {
          if (c.sceneCount === 0 && c.dialogueCount === 0) {
            return `${i + 1}. ${c.name} [未统计到出场]`;
          }
          return `${i + 1}. ${c.name} [出场${c.sceneCount}场, 对白${c.dialogueCount}条, 集数${c.episodeCount}]`;
        }).join('\n');
        
        const batchDialogues: string[] = [];
        for (const c of batch) {
          if (c.dialogueSamples.length > 0) {
            batchDialogues.push(`【${c.name}】`);
            batchDialogues.push(...c.dialogueSamples);
          }
        }
        
        const user = `【剧本信息】
剧名：《${background.title}》
${background.genre ? `类型：${background.genre}` : ''}
${background.era ? `时代背景：${background.era}` : ''}
${background.timelineSetting ? `时间线：${background.timelineSetting}` : ''}
总集数：${episodeScripts.length}集
总场次数：${totalSceneCount}场
核心主角阈值：出场 ≥ ${coreThreshold} 场

【故事大纲】
${outlineContext || '无'}

【人物小传】
${biosContext || '无'}

【待校准的角色列表 + 出场统计】（共${batch.length}个）
${charList}

【角色对白样本】
${batchDialogues.slice(0, 100).join('\n')}

请按照分级规则校准角色，返回JSON格式：
{
  "characters": [
    {
      "name": "角色名",
      "importance": "protagonist/supporting/minor/extra",
      "appearanceCount": 150,
      "dialogueCount": 200,
      "episodeSpan": [1, 60],
      "role": "角色描述",
      "age": "年龄",
      "gender": "性别",
      "relationships": "关系"
    }
  ],
  "filteredWords": ["被过滤的非角色词"],
  "filteredCharacters": [
    { "name": "被过滤的角色名", "reason": "过滤原因" }
  ],
  "mergeRecords": [
    { "finalName": "最终名", "variants": ["变体1", "变体2"], "reason": "原因" }
  ],
  "analysisNotes": "分析说明"
}

【极其重要！请特别注意】
1. ${strictness === 'strict' ? '严格过滤低频无名角色' : strictness === 'loose' ? '尽可能保留所有角色，包括群演' : '有名字的全部保留！有称呼的全部保留！不确定的保留！'}
2. 每个被过滤的角色必须在 filteredCharacters 中说明原因
3. 不要生成群演XX组标签`;
        return { system: systemPrompt, user };
      },
      parseResult: (raw) => {
        // 增强容错的 JSON 解析
        let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
        }
        
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        let batchParsed: any;
        try {
          batchParsed = JSON.parse(cleaned);
        } catch (jsonErr) {
          console.warn('[CharacterCalibrator] 批次JSON解析失败，尝试修复...');
          const lastCompleteChar = cleaned.lastIndexOf('},');
          if (lastCompleteChar > 0) {
            const truncated = cleaned.slice(0, lastCompleteChar + 1);
            const fixedJson = truncated + '],"filteredWords":[],"mergeRecords":[],"analysisNotes":"部分结果"}';
            try {
              batchParsed = JSON.parse(fixedJson);
            } catch {
              const charsMatch = cleaned.match(/"characters"\s*:\s*\[(.*?)\]/s);
              if (charsMatch) {
                try {
                  const charsArray = JSON.parse('[' + charsMatch[1] + ']');
                  batchParsed = { characters: charsArray, filteredWords: [], mergeRecords: [], analysisNotes: '部分结果' };
                } catch {
                  throw jsonErr;
                }
              } else {
                throw jsonErr;
              }
            }
          } else {
            throw jsonErr;
          }
        }
        
        // 收集聚合字段
        allFilteredWords.push(...(batchParsed.filteredWords || []));
        if (batchParsed.filteredCharacters) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          allFilteredCharacters.push(...batchParsed.filteredCharacters.map((fc: any) => ({
            name: fc.name || '',
            reason: fc.reason || '未说明',
          })));
        }
        allMergeRecords.push(...(batchParsed.mergeRecords || []));
        if (batchParsed.analysisNotes) allAnalysisNotes.push(batchParsed.analysisNotes);
        
        // 返回 Map<角色名, 角色数据>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = new Map<string, any>();
        for (const c of (batchParsed.characters || [])) {
          if (c.name) map.set(c.name, c);
        }
        return map;
      },
      estimateItemTokens: (item) => estimateTokens(
        `${item.name} [出场${item.sceneCount}场, 对白${item.dialogueCount}条] ` +
        item.dialogueSamples.join(' ')
      ),
      estimateItemOutputTokens: () => 200,
      apiOptions: {
        temperature: 0,
        maxTokens: 16384,
      },
    });
    
    if (failedBatches > 0) {
      console.warn(`[CharacterCalibrator] ${failedBatches} 批次失败，使用部分结果`);
    }
    
    parsed = {
      characters: Array.from(charResults.values()),
      filteredWords: [...new Set(allFilteredWords)],
      filteredCharacters: allFilteredCharacters,
      mergeRecords: allMergeRecords,
      analysisNotes: allAnalysisNotes.join('; ') || '批处理完成',
    };
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[CharacterCalibrator] AI角色分析失败:', err.message);
    console.error('[CharacterCalibrator] 错误堆栈:', err.stack);
    // 返回原始数据作为降级方案，但带上统计信息
    return {
      characters: rawCharacters.map((c, i) => {
        const s = stats.get(c.name);
        return {
          id: c.id || `char_${i + 1}`,
          name: c.name,
          importance: (s && s.sceneCount > 20 ? 'supporting' : 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                       s && s.sceneCount > 5 ? 'minor' : 'extra') as any,
          appearanceCount: s?.sceneCount || 1,
          role: c.role,
          nameVariants: [c.name],
        };
      }),
      filteredWords: [],
      filteredCharacters: [],
      mergeRecords: [],
      analysisNotes: `AI角色分析失败(${err.message})，返回基于统计的结果`,
    };
  }
    
  // === 第二步：转换为标准格式并添加ID ===
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const characters: CalibratedCharacter[] = (parsed.characters || []).map((c: any, i: number) => ({
    id: `char_${i + 1}`,
    name: c.name,
    importance: c.importance || 'minor',
    appearanceCount: c.appearanceCount || c.dialogueCount || 1,
    role: c.role,
    age: c.age,
    gender: c.gender,
    relationships: c.relationships,
    nameVariants: c.nameVariants || [c.name],
    episodeRange: c.episodeSpan,
  }));
    
  // === 第三步：为主角和重要配角生成专业视觉提示词（独立 try/catch，失败不影响校准结果）===
  let enrichedCharacters = characters;
  try {
    enrichedCharacters = await enrichCharactersWithVisualPrompts(
      characters,
      background,
      episodeScripts,
      promptLanguage
    );
  } catch (enrichError) {
    const err = enrichError instanceof Error ? enrichError : new Error(String(enrichError));
    console.warn('[CharacterCalibrator] 视觉提示词生成失败（不影响角色校准结果）:', err.message);
    // enrichment 失败不影响主要校准结果，继续使用 characters
  }
    
  // === 第四步：合并上次校准结果，防止角色丢失 ===
  let finalCharacters = enrichedCharacters;
  if (previousCharacters && previousCharacters.length > 0) {
    const currentNames = new Set(enrichedCharacters.map(c => c.name));
    
    // 找出上次有但这次没有的角色
    const missingCharacters = previousCharacters.filter(pc => {
      if (currentNames.has(pc.name)) return false;
      // loose 模式下保留所有上次的角色
      if (strictness === 'loose') return true;
      // 只保留有具体名字的角色
      const isGroupExtra = [
        '保安', '警察', '员工', '护士', '医生', '记者', 
        '律师', '路人', '众人', '若干', '群众', '大妈',
      ].some(keyword => 
        pc.name === keyword || 
        pc.name === keyword + '1' || 
        pc.name === keyword + '2' ||
        pc.name.startsWith('几名') ||
        pc.name.startsWith('两个') ||
        pc.name.startsWith('若干')
      );
      return !isGroupExtra && pc.importance !== 'extra';
    });
    
    if (missingCharacters.length > 0) {
      
      // 为丢失的角色重新分配 ID
      const maxId = Math.max(...finalCharacters.map(c => {
        const match = c.id.match(/char_(\d+)/);
        return match ? parseInt(match[1]) : 0;
      }));
      
      const recoveredChars = missingCharacters.map((c, i) => ({
        ...c,
        id: `char_${maxId + i + 1}`,
      }));
      
      finalCharacters = [...finalCharacters, ...recoveredChars];
    }
  }
  
  // 合并 filteredWords 和 filteredCharacters，确保 filteredWords 中的也出现在 filteredCharacters
  const filteredCharacters: FilteredCharacterRecord[] = [
    ...(parsed.filteredCharacters || []),
  ];
  // 将 filteredWords 中没有在 filteredCharacters 中的也加进去
  const filteredCharNames = new Set(filteredCharacters.map(fc => fc.name));
  for (const word of (parsed.filteredWords || [])) {
    if (!filteredCharNames.has(word)) {
      filteredCharacters.push({ name: word, reason: '非角色词' });
    }
  }
  
  return {
    characters: finalCharacters,
    filteredWords: parsed.filteredWords || [],
    filteredCharacters,
    mergeRecords: parsed.mergeRecords || [],
    analysisNotes: parsed.analysisNotes || '',
  };
}


export { enrichCharactersWithVisualPrompts } from "./character-calibrator-enrich";
