const AUDIO_FILE_EXTENSION_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;

export function normalizeReferenceText(value?: string) {
  const text = value?.trim();
  if (!text || looksLikeAudioPathText(text)) return undefined;
  return text;
}

export function looksLikeAudioPathText(value: string) {
  return /[\\/]/.test(value) || AUDIO_FILE_EXTENSION_PATTERN.test(value);
}
