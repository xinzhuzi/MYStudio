const RUNWAY_RATIO_MAP: Record<string, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "720:720",
  "4:3": "960:720",
  "3:4": "720:960",
  "21:9": "2048:880",
};

export function toRunwayRatio(aspectRatio: string): string {
  return RUNWAY_RATIO_MAP[aspectRatio] ?? aspectRatio;
}

export function toSoraSize(aspectRatio?: string, resolution?: string): string {
  const isPortrait = aspectRatio === "9:16" || aspectRatio === "3:4";
  const is1080 = (resolution || "").toLowerCase().includes("1080");
  if (is1080) return isPortrait ? "1080x1920" : "1920x1080";
  return isPortrait ? "720x1280" : "1280x720";
}

export function toVeoOpenAIVideoSize(aspectRatio?: string): string {
  const isPortrait = aspectRatio === "9:16" || aspectRatio === "3:4";
  return isPortrait ? "1080x1920" : "1920x1080";
}
