import { ApiKeyManager } from "@/lib/ai/core";
import { cleanJsonString, safeParseJson } from "@/lib/utils/json-cleaner";
import { delay } from "@/lib/utils/rate-limiter";
import type { ScriptData, Shot } from "@/types/script";
import { ShotGenerationOptions, callChatAPI } from "./script-parser-api";
import { SHOT_GENERATION_SYSTEM_PROMPT } from "./script-parser-prompts";

/**
 * 镜头列表生成——generateShotList 逐场景并行生成。file-size-reduction P2 拆出,体逐字保留。
 */

/**
 * Generate shot list from parsed script data
 * Uses per-scene generation with parallel processing support for multi-key
 */
export async function generateShotList(
  scriptData: ScriptData,
  options: ShotGenerationOptions,
  onSceneProgress?: (sceneIndex: number, total: number) => void,
  onShotsGenerated?: (newShots: Shot[], sceneIndex: number) => void // 流式回调，每个场景完成后立即通知
): Promise<Shot[]> {
  if (!scriptData.scenes || scriptData.scenes.length === 0) {
    return [];
  }

  const lang = options.language || scriptData.language || '中文';
  const allShots: Shot[] = [];
  
  // 计算每个场景应该生成的分镜数
  const totalScenes = scriptData.scenes.length;
  const targetShotCount = options.shotCount;
  const durationSec = options.targetDuration && options.targetDuration !== 'auto'
    ? (parseInt(options.targetDuration) || 0)
    : 0;

  // 确定每个场景的分镜数
  let shotsPerScene: number | undefined;
  let shotsPerSceneHint = '6-8个';
  if (targetShotCount) {
    // 用户明确指定了总分镜数
    shotsPerScene = Math.max(1, Math.ceil(targetShotCount / totalScenes));
  } else if (durationSec > 0) {
    // 根据时长计算合理的每场景分镜数（参考：每镜头约2-5秒）
    const totalBudget = Math.max(2, Math.ceil(durationSec / 3));
    shotsPerScene = Math.max(1, Math.ceil(totalBudget / totalScenes));
    shotsPerSceneHint = `${shotsPerScene}个（目标时长 ${durationSec}秒，总计约 ${totalBudget} 个分镜）`;
  }

  if (targetShotCount) {
  } else if (durationSec > 0) {
  }

  // Determine concurrency based on available keys
  const keyManager = new ApiKeyManager(options.apiKey);
  const keyCount = keyManager.getTotalKeyCount();
  if (keyCount <= 0) {
    throw new Error("API Key 未配置");
  }
  const requestedConcurrency = options.concurrency;
  const concurrency = requestedConcurrency === undefined || !Number.isFinite(requestedConcurrency)
    ? Math.min(keyCount, 4)
    : Math.max(1, Math.floor(requestedConcurrency)); // Max 4 parallel
  

  // Helper function to process a single scene
  const processScene = async (sceneIndex: number): Promise<Shot[]> => {
    const scene = scriptData.scenes[sceneIndex];
    const sceneShots: Shot[] = [];
    
    // Get paragraphs for this scene
    const paragraphs = scriptData.storyParagraphs
      .filter(p => String(p.sceneRefId) === String(scene.id))
      .map(p => p.text)
      .join('\n');

    const sceneContent = paragraphs.trim() 
      ? paragraphs 
      : `场景${sceneIndex + 1}: ${scene.name || scene.location}，${scene.atmosphere || ''}环境`;

    const userPrompt = `为场景 ${sceneIndex + 1} 生成电影级别的详细分镜。
输出语言: ${lang}

=== 场景信息 ===
场景名: ${scene.name || scene.location}
地点: ${scene.location}
时间: ${scene.time}
氛围: ${scene.atmosphere}
${scene.visualPrompt ? `场景视觉参考: ${scene.visualPrompt}` : ''}

=== 场景内容 ===
"${sceneContent.slice(0, 5000)}"

=== 项目信息 ===
类型: ${scriptData.genre || '通用'}
目标时长: ${options.targetDuration}
视觉风格: ${options.styleId}

=== 角色信息 ===
${scriptData.characters.map(c => `- ${c.name}: ${c.personality || ''} ${c.appearance || ''}`).join('\n')}

=== 分镜要求 ===
1. 为该场景生成${shotsPerScene ? `恰好 ${shotsPerScene} 个` : shotsPerSceneHint}镜头，挑选最具视觉冲击力的画面
2. 每个镜头必须包含：
   - shotSize: 景别（WS/MS/CU/ECU）
   - duration: 时长（秒）
   - visualDescription: 详细中文画面描述（像写电影剧本那样详细）
   - actionSummary: 简短动作概述
   - cameraMovement: 镜头运动
   - ambientSound: 环境声
   - soundEffect: 音效
   - dialogue: 对白（包含说话人和语气）
   - characters: 出场角色名列表
   - keyframes: 包含start关键帧的visualPrompt（英文，40词内）
3. visualDescription 要详细，包括光影、角色状态、气氛、镜头运动
4. 音频设计要具体，能复现场景氛围`;

    try {
      const response = await callChatAPI(SHOT_GENERATION_SYSTEM_PROMPT, userPrompt, options);
      const cleaned = cleanJsonString(response);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shots = safeParseJson<any[]>(cleaned, []);

      // Validate and transform shots - FORCE TRUNCATE to shotsPerScene
      let validShots = Array.isArray(shots) ? shots : [];
      
      // 强制截取到每场景限制数量（AI可能返回更多）
      if (shotsPerScene && validShots.length > shotsPerScene) {
        validShots = validShots.slice(0, shotsPerScene);
      }
      
      for (const s of validShots) {
        const characterIds = (s.characters || s.characterNames || [])
          .map((nameOrId: string) => {
            const char = scriptData.characters.find(
              c => c.name === nameOrId || c.id === nameOrId
            );
            return char?.id;
          })
          .filter(Boolean) as string[];

        const keyframes: NonNullable<Shot['keyframes']> = [];
        if (s.keyframes && Array.isArray(s.keyframes)) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          keyframes.push(...s.keyframes.map((k: any) => ({
            ...k,
            status: 'pending' as const })));
        } else if (s.visualPrompt) {
          keyframes.push({
            id: `kf-${sceneIndex}-${sceneShots.length}-start`,
            type: 'start' as const,
            visualPrompt: s.visualPrompt,
            status: 'pending' as const });
        }

        sceneShots.push({
          id: `shot_${sceneIndex}_${sceneShots.length}`,
          index: sceneShots.length + 1,
          sceneRefId: String(scene.id),
          actionSummary: s.actionSummary || '',
          visualDescription: s.visualDescription || '',
          cameraMovement: s.cameraMovement,
          shotSize: s.shotSize,
          duration: s.duration || 4,
          visualPrompt: s.visualPrompt || keyframes[0]?.visualPrompt || '',
          videoPrompt: s.videoPrompt || '',
          dialogue: s.dialogue,
          ambientSound: s.ambientSound || '',
          soundEffect: s.soundEffect || '',
          characterNames: s.characters || s.characterNames || [],
          characterIds,
          characterVariations: {},
          keyframes,
          imageStatus: 'idle' as const,
          imageProgress: 0,
          videoStatus: 'idle' as const,
          videoProgress: 0 });
      }
      
      
      // 流式回调：立即通知新生成的分镜
      if (onShotsGenerated && sceneShots.length > 0) {
        onShotsGenerated(sceneShots, sceneIndex);
      }
    } catch (e) {
      console.error(`[generateShotList] Failed for scene ${sceneIndex + 1}:`, e);
    }
    
    return sceneShots;
  };

  // Process scenes in parallel batches
  let completedCount = 0;
  for (let i = 0; i < scriptData.scenes.length; i += concurrency) {
    const batch = scriptData.scenes.slice(i, i + concurrency);
    const batchIndices = batch.map((_, idx) => i + idx);
    
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batchIndices.map(idx => processScene(idx))
    );
    
    // Collect results
    batchResults.forEach(shots => allShots.push(...shots));
    
    // Update progress
    completedCount += batch.length;
    if (onSceneProgress) {
      onSceneProgress(completedCount, scriptData.scenes.length);
    }
    
    // Small delay between batches to avoid overwhelming the API
    if (i + concurrency < scriptData.scenes.length) {
      await delay(500);
    }
  }

  // Re-index shots to be sequential
  let finalShots = allShots.map((s, idx) => ({
    ...s,
    id: `shot-${idx + 1}`,
    index: idx + 1 }));

  // 如果设置了分镜数量限制，截取到指定数量
  if (targetShotCount && finalShots.length > targetShotCount) {
    // 从每个场景均匀挑选，而不是简单截取前 N 个
    const sceneShotMap = new Map<string, Shot[]>();
    for (const shot of finalShots) {
      const sceneId = shot.sceneRefId;
      if (!sceneShotMap.has(sceneId)) {
        sceneShotMap.set(sceneId, []);
      }
      sceneShotMap.get(sceneId)!.push(shot);
    }

    // 从每个场景按比例挑选
    const selectedShots: Shot[] = [];
    const sceneIds = Array.from(sceneShotMap.keys());
    const shotsNeededPerScene = Math.ceil(targetShotCount / sceneIds.length);
    
    for (const sceneId of sceneIds) {
      const sceneShots = sceneShotMap.get(sceneId)!;
      // 取前 N 个（最重要的）
      selectedShots.push(...sceneShots.slice(0, shotsNeededPerScene));
    }

    // 截取到目标数量并重新编号
    finalShots = selectedShots.slice(0, targetShotCount).map((s, idx) => ({
      ...s,
      id: `shot-${idx + 1}`,
      index: idx + 1 }));
  }

  return finalShots;
}

/**
 * Generate a screenplay from creative input (idea, MV concept, ad brief, or storyboard script)
 * Output format is compatible with importFullScript() for seamless integration
 * 
 * Supports:
 * - One-liner ideas: "A love story in a coffee shop"
 * - MV concepts: "A music video about summer youth"
 * - Ad briefs: "30-second energy drink commercial"
 * - Detailed storyboard scripts: Scripts with shot descriptions
 */
