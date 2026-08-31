import { describe, expect, it } from 'vitest';
import { FREEDOM_STUDIO_MODES, isFreedomStudioMode } from './FreedomView';

describe('FreedomView studio mode guard', () => {
  it('accepts exactly the five supported studio modes', () => {
    expect(FREEDOM_STUDIO_MODES).toEqual(['image', 'video', 'cinema', 'tts', 'music']);
    for (const mode of FREEDOM_STUDIO_MODES) expect(isFreedomStudioMode(mode)).toBe(true);
  });

  it('rejects values outside the supported tabs', () => {
    expect(isFreedomStudioMode('unknown')).toBe(false);
    expect(isFreedomStudioMode('')).toBe(false);
  });
});
