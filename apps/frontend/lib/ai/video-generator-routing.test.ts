import { describe, expect, it } from 'vitest';
import { detectVideoApiFormat, getUnifiedEndpointPaths } from './video-generator-routing';

describe('video generator routing', () => {
  it('prioritizes endpoint metadata over model-name fallback', () => {
    expect(detectVideoApiFormat('wan-model', ['文生视频'])).toBe('kling');
    expect(detectVideoApiFormat('custom', ['org/model异步'])).toBe('replicate');
  });

  it('uses documented endpoint paths and default fallback', () => {
    expect(getUnifiedEndpointPaths(['luma视频生成']).poll('task-1')).toBe('/luma/generations/task-1');
    expect(getUnifiedEndpointPaths([]).submit).toBe('/v1/video/generations');
  });
});
