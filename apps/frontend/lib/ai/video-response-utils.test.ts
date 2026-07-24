import { describe, expect, it } from 'vitest';
import { extractVideoUrl, KLING_VIDEO_PATH_MAP, normalizeUrl, resolveKlingModelName } from './video-response-utils';

describe('video response helpers', () => {
  it.each([
    [{ data: [{ url: 'https://cdn.test/data.mp4' }] }, 'https://cdn.test/data.mp4'],
    [{ url: 'https://cdn.test/top-level.mp4' }, 'https://cdn.test/top-level.mp4'],
    [{ output: { url: 'https://cdn.test/output-object.mp4' } }, 'https://cdn.test/output-object.mp4'],
    [{ output: 'https://cdn.test/output.mp4' }, 'https://cdn.test/output.mp4'],
    [{ output: ['https://cdn.test/list.mp4'] }, 'https://cdn.test/list.mp4'],
    [{ outputs: ['https://cdn.test/outputs.mp4'] }, 'https://cdn.test/outputs.mp4'],
    [{ video_url: 'https://cdn.test/video-url.mp4' }, 'https://cdn.test/video-url.mp4'],
    [{ result_url: 'https://cdn.test/result-url.mp4' }, 'https://cdn.test/result-url.mp4'],
    [{ response: { url: 'https://cdn.test/response.mp4' } }, 'https://cdn.test/response.mp4'],
  ])('extracts %s', (payload, expected) => {
    expect(extractVideoUrl(payload)).toBe(expected);
  });

  it('normalizes arrays and rejects unsupported URL values', () => {
    expect(normalizeUrl('https://cdn.test/video.mp4')).toBe('https://cdn.test/video.mp4');
    expect(normalizeUrl(['https://cdn.test/video.mp4'])).toBe('https://cdn.test/video.mp4');
    expect(normalizeUrl([])).toBeUndefined();
    expect(normalizeUrl(null)).toBeUndefined();
    expect(normalizeUrl({ url: 'https://cdn.test/video.mp4' })).toBeUndefined();
    expect(extractVideoUrl({ output: 'relative/path.mp4' })).toBeNull();
    expect(extractVideoUrl({ output: [123] })).toBeNull();
    expect(extractVideoUrl({ data: { url: 'https://cdn.test/data-object.mp4' } })).toBeNull();
    expect(extractVideoUrl({})).toBeNull();
  });

  it('resolves Kling composite IDs while preserving native IDs and endpoint paths', () => {
    expect(resolveKlingModelName('kling-image-v1-5')).toBe('kling-v1-5');
    expect(resolveKlingModelName('kling-v2-6')).toBe('kling-v2-6');
    expect(KLING_VIDEO_PATH_MAP['kling-motion-control']).toBe('motion-control');
  });
});
