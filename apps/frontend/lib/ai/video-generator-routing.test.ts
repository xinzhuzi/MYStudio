import { describe, expect, it } from 'vitest';
import { detectVideoApiFormat, getUnifiedEndpointPaths } from './video-generator-routing';

describe('video generator routing', () => {
  it('prioritizes endpoint metadata over model-name fallback', () => {
    expect(detectVideoApiFormat('wan-model', ['文生视频'])).toBe('kling');
    expect(detectVideoApiFormat('custom', ['org/model异步'])).toBe('replicate');
    expect(detectVideoApiFormat('kling-model', ['openAI官方视频格式'])).toBe('openai_official');
    expect(detectVideoApiFormat('custom', ['豆包视频异步'])).toBe('volc');
    expect(detectVideoApiFormat('custom', ['异步'])).toBe('wan');
    expect(detectVideoApiFormat('custom', ['openai'])).toBe('unified');
  });

  it('uses documented endpoint paths and default fallback', () => {
    expect(getUnifiedEndpointPaths(['luma视频生成']).poll('task-1')).toBe('/luma/generations/task-1');
    expect(getUnifiedEndpointPaths(['unknown', 'grok视频']).submit).toBe('/v1/video/create');
    expect(getUnifiedEndpointPaths(['unknown', 'grok视频']).poll('task-2')).toBe('/v1/video/query?id=task-2');
    expect(getUnifiedEndpointPaths(['runway图生视频']).submit).toBe('/runwayml/v1/image_to_video');
    expect(getUnifiedEndpointPaths(['wan视频生成']).poll('task-3')).toBe('/alibailian/api/v1/tasks/task-3');
    expect(getUnifiedEndpointPaths([]).submit).toBe('/v1/video/generations');
  });

  it.each([
    ['SORA-2-foo', 'openai_official'],
    ['my-kling-video', 'kling'],
    ['doubao-video', 'volc'],
    ['seedance-v1', 'volc'],
    ['seedream-v1', 'volc'],
    ['WAN-2.2', 'wan'],
    ['custom-model', 'unified'],
  ] as const)('falls back from model name %s', (model, expected) => {
    expect(detectVideoApiFormat(model)).toBe(expected);
  });
});
