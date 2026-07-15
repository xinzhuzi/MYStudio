import { useCallback } from 'react';
import { toast } from 'sonner';

import { aiManager } from '@/lib/ai/ai-manager';
import {
  generateEpisodeSynopses,
  getMissingSynopsisEpisodes,
} from '@/lib/script/full-script-service';

type SynopsisStatus = 'idle' | 'generating' | 'completed' | 'error';

interface UseScriptSynopsisGenerationOptions {
  projectId: string;
  episodeCount: number;
  setStatus: (status: SynopsisStatus) => void;
  setMissingSynopsisCount: (count: number) => void;
}

export function useScriptSynopsisGeneration({
  projectId,
  episodeCount,
  setStatus,
  setMissingSynopsisCount,
}: UseScriptSynopsisGenerationOptions) {
  return useCallback(async () => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }

    setStatus('generating');
    toast.info(`正在为 ${episodeCount} 集生成大纲...`);

    try {
      const result = await generateEpisodeSynopses(
        projectId,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform,
          baseUrl: featureConfig.baseUrl,
          model: featureConfig.models?.[0],
        },
        (_current, _total, message) => {
          console.log(`[ScriptView] Synopsis: ${message}`);
        },
      );

      if (!result.success) throw new Error(result.error || '大纲生成失败');
      setStatus('completed');
      setMissingSynopsisCount(getMissingSynopsisEpisodes(projectId).length);
      toast.success(`大纲生成完成！已为 ${result.generatedCount} 集生成大纲`);
    } catch (error) {
      const err = error as Error;
      console.error('[ScriptView] Synopsis generation failed:', err);
      setStatus('error');
      toast.error(`大纲生成失败: ${err.message}`);
    }
  }, [episodeCount, projectId, setMissingSynopsisCount, setStatus]);
}
