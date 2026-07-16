import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareOne: vi.fn(),
  upload: vi.fn(),
  readImage: vi.fn(),
}));

vi.mock('@/lib/ai/image-transfer', () => ({
  prepareReferenceImageForTransfer: mocks.prepareOne,
}));
vi.mock('@/lib/image-host', () => ({
  isImageHostConfigured: () => true,
  uploadToImageHost: mocks.upload,
}));
vi.mock('@/lib/image-storage', () => ({
  readImageAsBase64: mocks.readImage,
}));

import { uploadBase64Image } from './image-upload';

describe('image-host reference upload gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads only the prepared thumbnail', async () => {
    mocks.readImage.mockResolvedValue('data:image/png;base64,b3JpZ2luYWw=');
    mocks.prepareOne.mockResolvedValue('data:image/jpeg;base64,dGh1bWI=');
    mocks.upload.mockResolvedValue({ success: true, url: 'https://image-host.example.com/thumb.jpg' });

    await expect(uploadBase64Image('local-image://character.png'))
      .resolves.toBe('https://image-host.example.com/thumb.jpg');
    expect(mocks.upload).toHaveBeenCalledWith(
      'data:image/jpeg;base64,dGh1bWI=',
      expect.objectContaining({ expiration: 15552000 }),
    );
  });

  it('does not upload malformed image data', async () => {
    mocks.prepareOne.mockRejectedValue(new Error('参考图发送前缩略失败'));

    await expect(uploadBase64Image('data:image/png;base64,%%%'))
      .rejects.toThrow('参考图发送前缩略失败');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
