import type { TtsSpeakerId } from "@/types/tts";

export function toRoleSpeakerId(characterId: string): TtsSpeakerId {
  const normalized = characterId.trim();
  if (normalized.startsWith("character:")) {
    return normalized as TtsSpeakerId;
  }
  return `character:${normalized}` as TtsSpeakerId;
}
