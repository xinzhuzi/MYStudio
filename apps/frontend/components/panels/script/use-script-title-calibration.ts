import { useCallback } from 'react';
import { toast } from 'sonner';

import { aiManager } from '@/lib/ai/ai-manager';
import { calibrateEpisodeTitles, getMissingTitleEpisodes } from '@/lib/script/full-script-service';
import type { ScriptCalibrationStatus } from '@/stores/script-store';

interface UseScriptTitleCalibrationOptions {
  projectId: string;
  setStatus: (status: ScriptCalibrationStatus) => void;
  setMissingTitleCount: (count: number) => void;
}

export function useScriptTitleCalibration({
  projectId,
  setStatus,
  setMissingTitleCount,
}: UseScriptTitleCalibrationOptions) {
  return useCallback(async () => {
    const featureConfig = aiManager.featureConfig('script_analysis');
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage('script_analysis'));
      return;
    }

    const missing = getMissingTitleEpisodes(projectId);
    if (missing.length === 0) {
      toast.info('所有集数都已有标题');
      return;
    }

    setStatus('calibrating');
    toast.info(`正在为 ${missing.length} 集生成标题...`);

    try {
      const result = await calibrateEpisodeTitles(
        projectId,
        {
          apiKey: featureConfig.allApiKeys.join(','),
          provider: featureConfig.platform,
          baseUrl: featureConfig.baseUrl,
          model: featureConfig.models?.[0],
        },
        (_current, _total, message) => {
          console.log(`[ScriptView] Calibration: ${message}`);
        },
      );

      if (!result.success) throw new Error(result.error || '校准失败');
      setStatus('completed');
      setMissingTitleCount(result.totalMissing - result.calibratedCount);
      toast.success(`校准完成！已为 ${result.calibratedCount} 集生成标题`);
    } catch (error) {
      const err = error as Error;
      console.error('[ScriptView] Calibration failed:', err);
      setStatus('error');
      toast.error(`校准失败: ${err.message}`);
    }
  }, [projectId, setMissingTitleCount, setStatus]);
}
