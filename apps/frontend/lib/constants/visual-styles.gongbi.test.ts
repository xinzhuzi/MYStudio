import { describe, expect, it } from 'vitest';
import { VISUAL_STYLE_PRESETS } from './visual-styles';

describe('2d_gongbi preset', () => {
  it('keeps its stable ID while using the GPT-safe Daojie gongbi-v2 contract', () => {
    const preset = VISUAL_STYLE_PRESETS.find((item) => item.id === '2d_gongbi');

    expect(preset).toBeDefined();
    expect(preset?.prompt).toContain('line-first continuous baimiao');
    expect(preset?.prompt).toContain('30%-70% visible chromatic area');
    expect(preset?.prompt).toContain('target near 30%-40%');
    expect(preset?.prompt).toContain('Medium rules take priority');
    expect(preset?.prompt).toContain('intact wearable clothing');
    expect(`${preset?.prompt} ${preset?.negativePrompt}`).not.toMatch(/\([^()]{1,200}:\s*\d+(?:\.\d+)?\)/);
    expect(preset?.negativePrompt).toContain('dirty texture');
    expect(preset?.negativePrompt).toContain('cinematic volumetric fog');
  });
});
