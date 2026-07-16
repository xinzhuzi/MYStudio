import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shot } from '@/types/script';

const mocks = vi.hoisted(() => ({
  prepareMany: vi.fn(),
}));

vi.mock('@/lib/ai/image-transfer', () => ({
  prepareReferenceImagesForTransfer: mocks.prepareMany,
}));

vi.mock('@/lib/ai/ai-manager', () => ({ aiManager: { imageGrid: vi.fn() } }));
vi.mock('@/stores/app-settings-store', () => ({
  useAppSettingsStore: { getState: () => ({ imageGenerationSettings: {} }) },
}));

import { generateShotVideo } from './shot-generator';

const shot = {
  id: 'shot-1',
  index: 1,
  actionSummary: '角色继续前行',
  duration: 5,
} as Shot;

describe('shot video image transfer gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends only prepared first-frame and reference payloads', async () => {
    mocks.prepareMany.mockResolvedValue([
      'data:image/jpeg;base64,ZnJhbWU=',
      'data:image/jpeg;base64,cmVmMQ==',
      'https://cdn.example.com/ref-2.png',
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { task_id: 'task-1' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', result: { videos: [{ url: 'https://cdn.example.com/video.mp4' }] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateShotVideo(
      shot,
      'project-file://shot-001.png',
      {
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'video-model',
        referenceImages: ['file:///ref-1.png', 'https://cdn.example.com/ref-2.png'],
      },
    );

    expect(result).toBe('https://cdn.example.com/video.mp4');
    expect(mocks.prepareMany).toHaveBeenCalledWith([
      'project-file://shot-001.png',
      'file:///ref-1.png',
      'https://cdn.example.com/ref-2.png',
    ]);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.image_with_roles).toEqual([
      { url: 'data:image/jpeg;base64,ZnJhbWU=', role: 'first_frame' },
      { url: 'data:image/jpeg;base64,cmVmMQ==', role: 'reference_image' },
      { url: 'https://cdn.example.com/ref-2.png', role: 'reference_image' },
    ]);
  });

  it('does not call the provider when thumbnail preparation fails', async () => {
    mocks.prepareMany.mockRejectedValue(new Error('参考图发送前缩略失败'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateShotVideo(
      shot,
      'data:image/png;base64,%%%',
      { apiKey: 'test-key', baseUrl: 'https://api.example.com', model: 'video-model' },
    )).rejects.toThrow('参考图发送前缩略失败');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
