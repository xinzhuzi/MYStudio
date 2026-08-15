import { describe, expect, it } from 'vitest';
import { VISUAL_STYLE_PRESETS } from './visual-styles';

describe('2d_gongbi preset', () => {
  it('keeps its stable ID while using the GPT-safe Daojie gongbi-v2 contract', () => {
    const preset = VISUAL_STYLE_PRESETS.find((item) => item.id === '2d_gongbi');

    expect(preset).toBeDefined();
    expect(preset?.prompt).toContain('line-first continuous baimiao');
    expect(preset?.prompt).toContain('Ink-first with restrained color accents');
    expect(preset?.prompt).toContain('at most two or three restrained mineral accents');
    expect(preset?.prompt).toContain('smooth pale matte flat-wash ground');
    expect(preset?.prompt).toContain('Medium rules take priority');
    expect(preset?.prompt).toContain('intact wearable clothing');
    expect(preset?.prompt).toContain('Low-noise rendering');
    expect(preset?.prompt).toContain('denoised fine detail');
    expect(preset?.prompt).toContain('clear legible surfaces');
    expect(preset?.prompt).toContain('smooth matte finish');
    expect(preset?.prompt).toContain('controlled ink wash');
    expect(`${preset?.prompt} ${preset?.negativePrompt}`).not.toMatch(/\([^()]{1,200}:\s*\d+(?:\.\d+)?\)/);
    expect(preset?.negativePrompt).toContain('dirty/muddy texture');
    expect(preset?.negativePrompt).toContain('visual noise');
    expect(preset?.negativePrompt).toContain('compression artifacts');
    expect(preset?.negativePrompt).toContain('jpeg artifacts');
    expect(preset?.negativePrompt).toContain('oversharpening halos');
    expect(preset?.negativePrompt).toContain('random stains');
    expect(preset?.negativePrompt).toContain('messy lineart');
    expect(preset?.negativePrompt).toContain('cinematic volumetric fog');
    expect(preset?.negativePrompt).toContain('cinematic lighting');
    expect(preset?.negativePrompt).toContain('scanned-paper filter');
    expect(preset?.negativePrompt).toContain('full-frame cyan or blue-grey rendering');
    expect(preset?.prompt).not.toMatch(/cinematic\s+(?:lighting|light)/i);
    expect(preset?.prompt).not.toMatch(/full-frame\s+(?:cyan|blue-grey|gray-blue)/i);
  });
});
