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
  saveVideoToLocal: vi.fn(),
}));

import { convertToHttpUrl, prepareVideoImageRolesForTransfer } from './video-generator';

describe('video image-host transfer gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('thumbnails local image data before uploading it', async () => {
    mocks.readImage.mockResolvedValue('data:image/png;base64,b3JpZ2luYWw=');
    mocks.prepareOne.mockResolvedValue('data:image/jpeg;base64,dGh1bWI=');
    mocks.upload.mockResolvedValue({ success: true, url: 'https://image-host.example.com/thumb.jpg' });

    const result = await convertToHttpUrl('local-image://character.png');

    expect(mocks.prepareOne).toHaveBeenCalledWith('data:image/png;base64,b3JpZ2luYWw=');
    expect(mocks.upload).toHaveBeenCalledWith(
      'data:image/jpeg;base64,dGh1bWI=',
      expect.objectContaining({ expiration: 15552000 }),
    );
    expect(result).toBe('https://image-host.example.com/thumb.jpg');
  });

  it('preserves remote HTTP images without a local transfer', async () => {
    await expect(convertToHttpUrl('https://cdn.example.com/reference.png'))
      .resolves.toBe('https://cdn.example.com/reference.png');
    expect(mocks.prepareOne).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('does not upload when thumbnail preparation fails', async () => {
    mocks.prepareOne.mockRejectedValue(new Error('参考图发送前缩略失败'));

    await expect(convertToHttpUrl('data:image/png;base64,%%%'))
      .rejects.toThrow('参考图发送前缩略失败');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('prepares direct video API roles sequentially', async () => {
    mocks.prepareOne
      .mockResolvedValueOnce('data:image/jpeg;base64,ZnJhbWU=')
      .mockResolvedValueOnce('data:image/jpeg;base64,dGFpbA==');

    await expect(prepareVideoImageRolesForTransfer([
      { url: 'project-file://first.png', role: 'first_frame' },
      { url: 'file:///last.png', role: 'last_frame' },
    ])).resolves.toEqual([
      { url: 'data:image/jpeg;base64,ZnJhbWU=', role: 'first_frame' },
      { url: 'data:image/jpeg;base64,dGFpbA==', role: 'last_frame' },
    ]);
    expect(mocks.prepareOne.mock.calls).toEqual([
      ['project-file://first.png'],
      ['file:///last.png'],
    ]);
  });
});
