import { describe, expect, it } from 'vitest';

import { normalizeImageHostProvider, normalizeImageHostProviders, type ImageHostProvider } from './api-config-image-host';

const provider = (platform: ImageHostProvider['platform'], overrides: Partial<ImageHostProvider> = {}): ImageHostProvider => ({
  id: platform,
  platform,
  name: platform,
  baseUrl: '',
  uploadPath: '',
  apiKey: '',
  enabled: true,
  ...overrides,
});

describe('image host normalization', () => {
  it('enforces Catbox and SCDN upload contracts', () => {
    expect(normalizeImageHostProvider(provider('catbox', { responseUrlField: 'stale' }))).toMatchObject({
      baseUrl: 'https://catbox.moe', imageField: 'fileToUpload', imagePayloadType: 'file',
      staticFormFields: { reqtype: 'fileupload' }, responseUrlField: undefined,
    });
    expect(normalizeImageHostProvider(provider('scdn'))).toMatchObject({
      baseUrl: 'https://img.scdn.io', imageField: 'image', responseUrlField: 'url',
    });
  });

  it('enforces ImgBB and ImgURL API field contracts', () => {
    expect(normalizeImageHostProvider(provider('imgbb'))).toMatchObject({
      apiKeyParam: 'key', expirationParam: 'expiration', imageField: 'image',
      responseUrlField: 'data.url', responseDeleteUrlField: 'data.delete_url',
    });
    expect(normalizeImageHostProvider(provider('imgurl'))).toMatchObject({
      apiKeyHeader: 'Authorization', imageField: 'file', responseUrlField: 'data.url',
    });
  });

  it('keeps custom providers and filters hidden legacy platforms', () => {
    const custom = provider('custom', { baseUrl: 'https://custom.example' });
    expect(normalizeImageHostProvider(custom)).toBe(custom);
    expect(normalizeImageHostProviders([custom, provider('scdn'), { ...custom, id: 'legacy', platform: 'legacy' as never }]).map((item) => item.id))
      .toEqual(['custom', 'scdn']);
  });
});
