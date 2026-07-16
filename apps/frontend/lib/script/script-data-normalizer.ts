import type { ScriptData } from "@/types/script";

/** Purely normalize the loosely-typed JSON returned by the script model. */
export function normalizeScriptData(
  parsed: Record<string, any>,
  language = "中文",
): ScriptData {
  const scenes = (parsed.scenes || []).map((s: any, i: number) => ({
    id: s.id || `scene_${i + 1}`,
    name: s.name || s.location || `场景${i + 1}`,
    location: s.location || "未知地点",
    time: normalizeTimeValue(s.time),
    atmosphere: s.atmosphere || "",
    visualPrompt: s.visualPrompt || "",
    tags: s.tags || [],
    notes: s.notes || "",
    episodeId: s.episodeId,
  }));
  const characters = (parsed.characters || []).map((c: any, i: number) => ({
    id: c.id || `char_${i + 1}`,
    name: c.name || `角色${i + 1}`,
    gender: c.gender,
    age: c.age,
    personality: c.personality,
    role: c.role,
    traits: c.traits,
    skills: c.skills,
    keyActions: c.keyActions,
    appearance: c.appearance,
    relationships: c.relationships,
    tags: c.tags || [],
    notes: c.notes || "",
  }));
  let episodes = (parsed.episodes || []).map((e: any, i: number) => ({
    id: e.id || `ep_${i + 1}`,
    index: e.index || i + 1,
    title: e.title || `第${i + 1}集`,
    description: e.description,
    sceneIds: e.sceneIds || [],
  }));
  if (episodes.length === 0) {
    episodes = [{ id: "ep_1", index: 1, title: parsed.title || "第1集", description: parsed.logline, sceneIds: scenes.map((s: any) => s.id) }];
  } else {
    const assigned = new Set(episodes.flatMap((e: any) => e.sceneIds));
    const unassigned = scenes.filter((s: any) => !assigned.has(s.id));
    if (unassigned.length > 0) episodes[episodes.length - 1].sceneIds.push(...unassigned.map((s: any) => s.id));
  }
  return {
    title: parsed.title || "未命名剧本",
    genre: parsed.genre,
    logline: parsed.logline,
    language,
    characters,
    scenes,
    episodes,
    storyParagraphs: (parsed.storyParagraphs || []).map((p: any, i: number) => ({ id: p.id || i + 1, text: p.text || "", sceneRefId: p.sceneRefId || "scene_1" })),
  };
}

export function normalizeTimeValue(time: string | undefined): string {
  if (!time) return "day";
  const map: Record<string, string> = { 白天: "day", 日间: "day", 上午: "day", 下午: "day", 夜晚: "night", 夜间: "night", 深夜: "midnight", 半夜: "midnight", 黄昏: "dusk", 日落: "dusk", 働晚: "dusk", 黎明: "dawn", 早晨: "dawn", 清晨: "dawn", 日出: "dawn", 中午: "noon", 正午: "noon", day: "day", night: "night", dawn: "dawn", dusk: "dusk", noon: "noon", midnight: "midnight" };
  const normalized = time.toLowerCase().trim();
  return map[normalized] || map[time] || "day";
}
