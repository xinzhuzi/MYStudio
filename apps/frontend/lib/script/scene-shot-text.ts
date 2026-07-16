import type { Shot } from '@/types/script';

/**
 * Returns the shot fields used for viewpoint keyword matching.
 * Keeping this normalization pure makes the matching pipeline reusable.
 */
export function getShotSearchableText(shot: Shot): string {
  const parts = [
    shot.actionSummary || '',
    shot.dialogue || '',
    shot.visualDescription || '',
    shot.characterBlocking || '',
  ];
  return parts.join(' ');
}
