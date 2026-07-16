import type { Shot } from "@/types/script";
import { useScriptStore } from "@/stores/script-store";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { runStaggered } from "@/lib/utils/concurrency";
import { calibrateShotsMultiStage } from "./shot-calibration-stages";
import { buildSeriesContextSummary } from "./series-meta-sync";
import { applyPromptLanguageToShotPrompts } from "./prompt-language";
import {
  callAIForShotCalibration,
  type ShotCalibrationOptions,
} from "./shot-calibration-prompt-service";

export interface ShotCalibrationResult {
  success: boolean;
  calibratedCount: number;
  totalShots: number;
  error?: string;
}

/**
 * AI校准分镜：优化中文描述、生成英文visualPrompt、优化镜头设计
 */
export async function calibrateEpisodeShots(
  episodeIndex: number,
  projectId: string,
  options: ShotCalibrationOptions,
  onProgress?: (current: number, total: number, message: string) => void,
  filterSceneId?: string,
): Promise<ShotCalibrationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: '项目不存在' };
  }
  
  // 找到该集的分镜
  const scriptData = project.scriptData;
  if (!scriptData) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: '剧本数据不存在' };
  }
  
  const episode = scriptData.episodes.find(ep => ep.index === episodeIndex);
  if (!episode) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: `找不到第 ${episodeIndex} 集` };
  }
  
  // 获取该集的所有分镜（可选：只校准指定场景的分镜）
  let episodeShots = project.shots.filter(shot => shot.episodeId === episode.id);
  if (filterSceneId) {
    episodeShots = episodeShots.filter(shot => shot.sceneRefId === filterSceneId);
  }
  const totalShots = episodeShots.length;
  
  if (totalShots === 0) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: '该集没有分镜' };
  }
  
  onProgress?.(0, totalShots, `开始校准第 ${episodeIndex} 集的 ${totalShots} 个分镜...`);
  
  // 获取全局背景信息
  const background = project.projectBackground;
  const episodeScript = project.episodeRawScripts.find(ep => ep.episodeIndex === episodeIndex);
  
  // 提取该集的原始剧本内容（对白+动作）
  const episodeRawContent = episodeScript?.rawContent || '';
  
  // 构建剧级上下文摘要
  const seriesContextSummary = buildSeriesContextSummary(project.seriesMeta || null);
  
  const globalContext = {
    title: background?.title || project.scriptData?.title || '未命名剧本',
    genre: background?.genre || '',
    era: background?.era || '',
    outline: background?.outline || '',
    characterBios: background?.characterBios || '',
    worldSetting: background?.worldSetting || '',
    themes: background?.themes || [],
    episodeTitle: episode.title,
    episodeSynopsis: episodeScript?.synopsis || '',  // 使用每集大纲
    episodeKeyEvents: episodeScript?.keyEvents || [],  // 关键事件
    episodeRawContent,  // 该集原始剧本内容（完整对白、动作描写）
    episodeSeason: episodeScript?.season,  // 本集季节
    totalEpisodes: project.episodeRawScripts.length,
    currentEpisode: episodeIndex,
    seriesContextSummary,  // 剧级上下文
  };
  
  // 构建原始场景天气映射（从原始解析的场景中获取 weather）
  const rawSceneWeatherMap = new Map<string, string>();
  if (episodeScript?.scenes) {
    for (const rawScene of episodeScript.scenes) {
      if (rawScene.weather) {
        // 用场景头做 key
        rawSceneWeatherMap.set(rawScene.sceneHeader, rawScene.weather);
      }
    }
  }
  
  try {
    // 获取用户设置的并发数
    const concurrency = useAPIConfigStore.getState().concurrency || 1;
    const batchSize = 5; // 每个 AI 调用处理 5 个分镜
    let calibratedCount = 0;
    const updatedShots: Shot[] = [...project.shots];
    
    // 准备所有批次任务
    const allBatches: { batch: Shot[]; batchNum: number; batchData: any[] }[] = [];
    for (let i = 0; i < episodeShots.length; i += batchSize) {
      const batch = episodeShots.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      // 准备批次数据
      const batchData = batch.map(shot => {
        const scene = scriptData.scenes.find(s => s.id === shot.sceneRefId);
        let sourceText = shot.actionSummary || '';
        if (shot.dialogue) {
          sourceText += `\n对白：「${shot.dialogue}」`;
        }
        // 尝试查找场景对应的天气
        let sceneWeather = '';
        for (const [header, weather] of rawSceneWeatherMap) {
          if (scene?.location && header.includes(scene.location.replace(/\s+/g, ''))) {
            sceneWeather = weather;
            break;
          }
        }
        return {
          shotId: shot.id,
          sourceText,
          actionSummary: shot.actionSummary,
          dialogue: shot.dialogue,
          characterNames: shot.characterNames,
          sceneLocation: scene?.location || '',
          sceneAtmosphere: scene?.atmosphere || '',
          sceneTime: scene?.time || 'day',
          sceneWeather,
          architectureStyle: scene?.architectureStyle || '',
          colorPalette: scene?.colorPalette || '',
          eraDetails: scene?.eraDetails || '',
          lightingDesign: scene?.lightingDesign || '',
          currentShotSize: shot.shotSize,
          currentCameraMovement: shot.cameraMovement,
          currentDuration: shot.duration,
        };
      });
      
      allBatches.push({ batch, batchNum, batchData });
    }
    
    const totalBatches = allBatches.length;
    console.log(`🚀 [calibrateShots] 待处理: ${totalShots} 个分镜，${totalBatches} 批，并发数: ${concurrency}`);
    
    // 错开启动的并发控制：每5秒启动一个新批次，同时最多 concurrency 个
    let completedBatches = 0;
    const settledBatchResults = await runStaggered(
      allBatches.map(({ batch, batchNum, batchData }) => async () => {
        console.log(`[calibrateShots] 🚀 启动批次 ${batchNum}/${totalBatches}`);
        onProgress?.(calibratedCount, totalShots, `🚀 处理批次 ${batchNum}/${totalBatches}...`);
        
        // 带重试机制的 AI 调用
        let calibrations: Record<string, any> = {};
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            calibrations = await calibrateShotsMultiStage(
              batchData,
              { styleId: options.styleId, cinematographyProfileId: options.cinematographyProfileId, promptLanguage: options.promptLanguage },
              globalContext,
              (stage, total, name) => {
                console.log(`[calibrateShots] 批次 ${batchNum}/${totalBatches} - Stage ${stage}/${total}: ${name}`);
                onProgress?.(calibratedCount, totalShots, `批次 ${batchNum} Stage ${stage}/${total}: ${name}`);
              }
            );
            completedBatches++;
            console.log(`[calibrateShots] ✅ 批次 ${batchNum} 完成，进度: ${completedBatches}/${totalBatches}`);
            return { batch, calibrations, success: true as const };
          } catch (err) {
            retryCount++;
            console.warn(`[calibrateShots] 批次 ${batchNum} 失败，重试 ${retryCount}/${maxRetries}:`, err);
            if (retryCount >= maxRetries) {
              console.error(`[calibrateShots] 批次 ${batchNum} 达到最大重试次数，跳过`);
              completedBatches++;
              return { batch, calibrations: {} as Record<string, any>, success: false as const };
            }
            await new Promise(r => setTimeout(r, 2000 * retryCount));
          }
        }
        completedBatches++;
        return { batch, calibrations, success: false as const };
      }),
      concurrency,
      5000
    );
    const results = settledBatchResults
      .filter((r): r is { status: 'fulfilled'; value: any } => r.status === 'fulfilled')
      .map(r => r.value);
    
    // 处理结果
    for (const { batch, calibrations, success } of results) {
      if (success) {
        for (const shot of batch) {
          const calibration = calibrations[shot.id];
          if (calibration) {
            const shotIndex = updatedShots.findIndex(s => s.id === shot.id);
            if (shotIndex !== -1) {
              updatedShots[shotIndex] = {
                ...updatedShots[shotIndex],
                visualDescription: calibration.visualDescription || updatedShots[shotIndex].visualDescription,
                shotSize: calibration.shotSize || updatedShots[shotIndex].shotSize,
                cameraMovement: calibration.cameraMovement || updatedShots[shotIndex].cameraMovement,
                duration: calibration.duration || updatedShots[shotIndex].duration,
                emotionTags: calibration.emotionTags || updatedShots[shotIndex].emotionTags,
                characterNames: calibration.characterNames?.length > 0 
                  ? calibration.characterNames 
                  : updatedShots[shotIndex].characterNames,
                ambientSound: calibration.ambientSound || updatedShots[shotIndex].ambientSound,
                soundEffect: calibration.soundEffect || updatedShots[shotIndex].soundEffect,
                ...applyPromptLanguageToShotPrompts(
                  updatedShots[shotIndex],
                  calibration,
                  options.promptLanguage || 'zh+en',
                ),
                needsEndFrame: calibration.needsEndFrame ?? updatedShots[shotIndex].needsEndFrame,
                narrativeFunction: calibration.narrativeFunction || updatedShots[shotIndex].narrativeFunction,
                conflictStage: calibration.conflictStage || updatedShots[shotIndex].conflictStage,
                shotPurpose: calibration.shotPurpose || updatedShots[shotIndex].shotPurpose,
                storyAlignment: calibration.storyAlignment || updatedShots[shotIndex].storyAlignment,
                visualFocus: calibration.visualFocus || updatedShots[shotIndex].visualFocus,
                cameraPosition: calibration.cameraPosition || updatedShots[shotIndex].cameraPosition,
                characterBlocking: calibration.characterBlocking || updatedShots[shotIndex].characterBlocking,
                rhythm: calibration.rhythm || updatedShots[shotIndex].rhythm,
                // 拍摄控制字段
                lightingStyle: calibration.lightingStyle || updatedShots[shotIndex].lightingStyle,
                lightingDirection: calibration.lightingDirection || updatedShots[shotIndex].lightingDirection,
                colorTemperature: calibration.colorTemperature || updatedShots[shotIndex].colorTemperature,
                lightingNotes: calibration.lightingNotes || updatedShots[shotIndex].lightingNotes,
                depthOfField: calibration.depthOfField || updatedShots[shotIndex].depthOfField,
                focusTarget: calibration.focusTarget || updatedShots[shotIndex].focusTarget,
                focusTransition: calibration.focusTransition || updatedShots[shotIndex].focusTransition,
                cameraRig: calibration.cameraRig || updatedShots[shotIndex].cameraRig,
                movementSpeed: calibration.movementSpeed || updatedShots[shotIndex].movementSpeed,
                atmosphericEffects: calibration.atmosphericEffects || updatedShots[shotIndex].atmosphericEffects,
                effectIntensity: calibration.effectIntensity || updatedShots[shotIndex].effectIntensity,
                playbackSpeed: calibration.playbackSpeed || updatedShots[shotIndex].playbackSpeed,
                cameraAngle: calibration.cameraAngle || updatedShots[shotIndex].cameraAngle,
                focalLength: calibration.focalLength || updatedShots[shotIndex].focalLength,
                photographyTechnique: calibration.photographyTechnique || updatedShots[shotIndex].photographyTechnique,
                specialTechnique: calibration.specialTechnique || updatedShots[shotIndex].specialTechnique,
              };
              calibratedCount++;
            }
          }
        }
      }
    }
    
    onProgress?.(calibratedCount, totalShots, `已校准 ${calibratedCount}/${totalShots} 个分镜`);
    
    // 保存更新后的分镜
    store.setShots(projectId, updatedShots);
    
    return {
      success: true,
      calibratedCount,
      totalShots,
    };
  } catch (error) {
    console.error('[calibrateShots] Error:', error);
    return {
      success: false,
      calibratedCount: 0,
      totalShots,
      error: error instanceof Error ? error.message : '分镜校准失败',
    };
  }
}

/**
 * AI校准单个分镜：用于预告片 Tab 点击单个分镜进行校准
 */
export async function calibrateSingleShot(
  shotId: string,
  projectId: string,
  options: ShotCalibrationOptions,
  onProgress?: (message: string) => void
): Promise<ShotCalibrationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, calibratedCount: 0, totalShots: 1, error: '项目不存在' };
  }
  
  const scriptData = project.scriptData;
  if (!scriptData) {
    return { success: false, calibratedCount: 0, totalShots: 1, error: '剧本数据不存在' };
  }
  
  // 找到目标分镜
  const shot = project.shots.find(s => s.id === shotId);
  if (!shot) {
    return { success: false, calibratedCount: 0, totalShots: 1, error: `找不到分镜 ${shotId}` };
  }
  
  onProgress?.(`正在校准分镜...`);
  
  // 获取分镜所属的场景和集信息
  const scene = scriptData.scenes.find(s => s.id === shot.sceneRefId);
  const episode = scriptData.episodes.find(ep => ep.id === shot.episodeId);
  const episodeIndex = episode?.index || 1;
  
  // 获取全局背景信息
  const background = project.projectBackground;
  const episodeScript = project.episodeRawScripts.find(ep => ep.episodeIndex === episodeIndex);
  const episodeRawContent = episodeScript?.rawContent || '';
  
  const globalContext = {
    title: background?.title || scriptData?.title || '未命名剧本',
    genre: background?.genre || '',
    era: background?.era || '',
    outline: background?.outline || '',
    characterBios: background?.characterBios || '',
    worldSetting: background?.worldSetting || '',
    themes: background?.themes || [],
    episodeTitle: episode?.title || `第${episodeIndex}集`,
    episodeSynopsis: episodeScript?.synopsis || '',
    episodeKeyEvents: episodeScript?.keyEvents || [],
    episodeRawContent,
    episodeSeason: episodeScript?.season,
    totalEpisodes: project.episodeRawScripts.length,
    currentEpisode: episodeIndex,
  };
  
  try {
    // 准备分镜数据
    let sourceText = shot.actionSummary || '';
    if (shot.dialogue) {
      sourceText += `\n对白：「${shot.dialogue}」`;
    }
    
    // 查找场景天气
    let sceneWeather = '';
    if (episodeScript?.scenes) {
      for (const rawScene of episodeScript.scenes) {
        if (rawScene.weather && scene?.location && rawScene.sceneHeader.includes(scene.location.replace(/\s+/g, ''))) {
          sceneWeather = rawScene.weather;
          break;
        }
      }
    }
    
    const shotData = [{
      shotId: shot.id,
      sourceText,
      actionSummary: shot.actionSummary || '',
      dialogue: shot.dialogue,
      characterNames: shot.characterNames,
      sceneLocation: scene?.location || '',
      sceneAtmosphere: scene?.atmosphere || '',
      sceneTime: scene?.time || 'day',
      sceneWeather,
      // 场景美术设计字段（从AI场景校准获取）
      architectureStyle: scene?.architectureStyle || '',
      colorPalette: scene?.colorPalette || '',
      eraDetails: scene?.eraDetails || '',
      lightingDesign: scene?.lightingDesign || '',
      currentShotSize: shot.shotSize,
      currentCameraMovement: shot.cameraMovement,
      currentDuration: shot.duration,
    }];
    
    // 调用 AI 校准
    const calibrations = await callAIForShotCalibration(shotData, options, globalContext);
    const calibration = calibrations[shot.id];
    
    if (!calibration) {
      return { success: false, calibratedCount: 0, totalShots: 1, error: 'AI 校准未返回结果' };
    }
    
    // 更新分镜
    const updatedShots = project.shots.map(s => {
      if (s.id !== shot.id) return s;
      return {
        ...s,
        visualDescription: calibration.visualDescription || s.visualDescription,
        shotSize: calibration.shotSize || s.shotSize,
        cameraMovement: calibration.cameraMovement || s.cameraMovement,
        duration: calibration.duration || s.duration,
        emotionTags: calibration.emotionTags || s.emotionTags,
        characterNames: calibration.characterNames?.length > 0 ? calibration.characterNames : s.characterNames,
        ambientSound: calibration.ambientSound || s.ambientSound,
        soundEffect: calibration.soundEffect || s.soundEffect,
        // 三层提示词系统（按 promptLanguage 清理旧字段）
        ...applyPromptLanguageToShotPrompts(
          s,
          calibration,
          options.promptLanguage || 'zh+en',
        ),
        needsEndFrame: calibration.needsEndFrame ?? s.needsEndFrame,
        // 叙事驱动字段
        narrativeFunction: calibration.narrativeFunction || s.narrativeFunction,
        conflictStage: calibration.conflictStage || s.conflictStage,
        shotPurpose: calibration.shotPurpose || s.shotPurpose,
        storyAlignment: calibration.storyAlignment || s.storyAlignment,
        visualFocus: calibration.visualFocus || s.visualFocus,
        cameraPosition: calibration.cameraPosition || s.cameraPosition,
        characterBlocking: calibration.characterBlocking || s.characterBlocking,
        rhythm: calibration.rhythm || s.rhythm,
        // 拍摄控制字段
        lightingStyle: calibration.lightingStyle || s.lightingStyle,
        lightingDirection: calibration.lightingDirection || s.lightingDirection,
        colorTemperature: calibration.colorTemperature || s.colorTemperature,
        lightingNotes: calibration.lightingNotes || s.lightingNotes,
        depthOfField: calibration.depthOfField || s.depthOfField,
        focusTarget: calibration.focusTarget || s.focusTarget,
        focusTransition: calibration.focusTransition || s.focusTransition,
        cameraRig: calibration.cameraRig || s.cameraRig,
        movementSpeed: calibration.movementSpeed || s.movementSpeed,
        atmosphericEffects: calibration.atmosphericEffects || s.atmosphericEffects,
        effectIntensity: calibration.effectIntensity || s.effectIntensity,
        playbackSpeed: calibration.playbackSpeed || s.playbackSpeed,
        cameraAngle: calibration.cameraAngle || s.cameraAngle,
        focalLength: calibration.focalLength || s.focalLength,
        photographyTechnique: calibration.photographyTechnique || s.photographyTechnique,
        specialTechnique: calibration.specialTechnique || s.specialTechnique,
      } as Shot;
    });
    
    store.setShots(projectId, updatedShots);
    onProgress?.(`分镜校准完成`);
    
    return {
      success: true,
      calibratedCount: 1,
      totalShots: 1,
    };
  } catch (error) {
    console.error('[calibrateSingleShot] Error:', error);
    return {
      success: false,
      calibratedCount: 0,
      totalShots: 1,
      error: error instanceof Error ? error.message : '单个分镜校准失败',
    };
  }
}


