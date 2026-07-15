import type { EpisodeRawScript } from "@/types/script";

export interface EpisodeGenerationSummary {
  total: number;
  completed: number;
  generating: number;
  idle: number;
  error: number;
}

type EpisodeGenerationState = Pick<EpisodeRawScript, "shotGenerationStatus">;

export function summarizeEpisodeGeneration(
  episodes: readonly EpisodeGenerationState[],
): EpisodeGenerationSummary {
  return episodes.reduce<EpisodeGenerationSummary>((summary, episode) => {
    summary.total += 1;
    summary[episode.shotGenerationStatus] += 1;
    return summary;
  }, { total: 0, completed: 0, generating: 0, idle: 0, error: 0 });
}
