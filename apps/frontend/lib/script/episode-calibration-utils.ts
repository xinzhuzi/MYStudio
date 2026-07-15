import type { EpisodeRawScript } from "@/types/script";

export function isMissingTitle(title: string): boolean {
  if (!title || title.trim() === "") return true;
  return /^第[\d一二三四五六七八九十百千]+集$/.test(title.trim());
}

export function extractEpisodeSummary(episode: EpisodeRawScript): string {
  const parts: string[] = [];
  for (const scene of episode.scenes.slice(0, 3)) {
    if (scene.sceneHeader) parts.push(`场景：${scene.sceneHeader}`);
    const dialogueSample = scene.dialogues
      .slice(0, 3)
      .map((dialogue) => `${dialogue.character}：${dialogue.line.slice(0, 30)}`)
      .join("\n");
    if (dialogueSample) parts.push(dialogueSample);
    const actionSample = scene.actions
      .slice(0, 2)
      .map((action) => action.slice(0, 50))
      .join("\n");
    if (actionSample) parts.push(actionSample);
  }
  return parts.join("\n").slice(0, 800) || "（无内容）";
}
