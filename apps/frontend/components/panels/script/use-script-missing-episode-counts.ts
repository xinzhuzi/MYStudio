import { useEffect, useState } from "react";
import {
  getMissingSynopsisEpisodes,
  getMissingTitleEpisodes,
} from "@/lib/script/full-script-service";
import type { ScriptImportStatus } from "@/stores/script-store";
import type { EpisodeRawScript } from "@/types/script";

type UseScriptMissingEpisodeCountsOptions = {
  importStatus: ScriptImportStatus;
  projectId: string;
  episodeRawScripts: EpisodeRawScript[];
};

export function useScriptMissingEpisodeCounts({
  importStatus,
  projectId,
  episodeRawScripts,
}: UseScriptMissingEpisodeCountsOptions) {
  const [missingTitleCount, setMissingTitleCount] = useState(0);
  const [missingSynopsisCount, setMissingSynopsisCount] = useState(0);

  useEffect(() => {
    if (importStatus === "ready" && projectId) {
      setMissingTitleCount(getMissingTitleEpisodes(projectId).length);
      setMissingSynopsisCount(getMissingSynopsisEpisodes(projectId).length);
    }
  }, [importStatus, projectId, episodeRawScripts]);

  return {
    missingTitleCount,
    setMissingTitleCount,
    missingSynopsisCount,
    setMissingSynopsisCount,
  };
}
