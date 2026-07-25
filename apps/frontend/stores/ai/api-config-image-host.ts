import { generateId } from '@/lib/api-key-manager';

export type ImageHostPlatform = 'imgbb' | 'imgurl' | 'scdn' | 'catbox' | 'cloudflare_r2' | 'custom';

export interface ImageHostProvider {
  id: string;
  platform: ImageHostPlatform;
  name: string;
  baseUrl: string;
  uploadPath: string;
  apiKey: string;
  enabled: boolean;
  apiKeyParam?: string;
  apiKeyHeader?: string;
  apiKeyFormField?: string;
  apiKeyOptional?: boolean;
  expirationParam?: string;
  imageField?: string;
  imagePayloadType?: 'base64' | 'file';
  nameField?: string;
  staticFormFields?: Record<string, string>;
  responseUrlField?: string;
  responseDeleteUrlField?: string;
}

export const IMAGE_HOST_PRESETS: Omit<ImageHostProvider, 'id' | 'apiKey'>[] = [
  { platform: 'scdn', name: 'SCDN 图床', baseUrl: 'https://img.scdn.io', uploadPath: '/api/v1.php', enabled: true, apiKeyOptional: true, imageField: 'image', imagePayloadType: 'file', responseUrlField: 'url' },
  { platform: 'catbox', name: 'Catbox', baseUrl: 'https://catbox.moe', uploadPath: '/user/api.php', enabled: false, apiKeyFormField: 'userhash', apiKeyOptional: true, imageField: 'fileToUpload', imagePayloadType: 'file', staticFormFields: { reqtype: 'fileupload' } },
  { platform: 'imgbb', name: 'imgbb', baseUrl: 'https://api.imgbb.com', uploadPath: '/1/upload', enabled: false, apiKeyParam: 'key', expirationParam: 'expiration', imageField: 'image', nameField: 'name', responseUrlField: 'data.url', responseDeleteUrlField: 'data.delete_url' },
  { platform: 'imgurl', name: 'ImgURL', baseUrl: 'https://www.imgurl.org', uploadPath: '/api/v3/upload', enabled: false, apiKeyHeader: 'Authorization', imageField: 'file', responseUrlField: 'data.url' },
  { platform: 'custom', name: '自定义图床', baseUrl: '', uploadPath: '', enabled: false },
  { platform: 'cloudflare_r2', name: 'Cloudflare R2', baseUrl: '', uploadPath: '', enabled: false },
];

export const DEFAULT_IMAGE_HOST_PROVIDERS: Omit<ImageHostProvider, 'id' | 'apiKey'>[] =
  IMAGE_HOST_PRESETS.filter((preset) => preset.platform === 'scdn' || preset.platform === 'imgbb');

const ACTIVE_IMAGE_HOST_PLATFORMS = new Set<ImageHostPlatform>(['imgbb', 'imgurl', 'scdn', 'catbox', 'cloudflare_r2', 'custom']);

export function isVisibleImageHostPlatform(platform: string): platform is ImageHostPlatform {
  return ACTIVE_IMAGE_HOST_PLATFORMS.has(platform as ImageHostPlatform);
}

export function isVisibleImageHostProvider(provider: Pick<ImageHostProvider, 'platform'>): boolean {
  return isVisibleImageHostPlatform(provider.platform);
}

export function findImageHostPreset(platform: ImageHostPlatform) {
  return IMAGE_HOST_PRESETS.find((preset) => preset.platform === platform);
}

export function createDefaultImageHostProviders(): ImageHostProvider[] {
  return DEFAULT_IMAGE_HOST_PROVIDERS.map((provider) => ({ ...provider, id: generateId(), apiKey: '' }));
}

export function isUnconfiguredDefaultImgBBProvider(provider: ImageHostProvider): boolean {
  const preset = findImageHostPreset('imgbb');
  return !!preset && provider.platform === 'imgbb' && (provider.apiKey || '').trim().length === 0
    && provider.name === preset.name && (provider.baseUrl || '') === preset.baseUrl
    && (provider.uploadPath || '') === preset.uploadPath;
}

export function isUnconfiguredDefaultCatboxProvider(provider: ImageHostProvider): boolean {
  const preset = findImageHostPreset('catbox');
  return !!preset && provider.platform === 'catbox' && (provider.apiKey || '').trim().length === 0
    && provider.name === preset.name && (provider.baseUrl || '') === preset.baseUrl
    && (provider.uploadPath || '') === preset.uploadPath;
}

type ImageHostProviderDefaults = Partial<Omit<ImageHostProvider, 'id' | 'name' | 'apiKey' | 'enabled'>>;

const PLATFORM_DEFAULTS: Partial<Record<ImageHostPlatform, ImageHostProviderDefaults>> = {
  imgbb: { baseUrl: 'https://api.imgbb.com', uploadPath: '/1/upload', apiKeyParam: 'key', expirationParam: 'expiration', imageField: 'image', nameField: 'name', responseUrlField: 'data.url', responseDeleteUrlField: 'data.delete_url' },
  imgurl: { baseUrl: 'https://www.imgurl.org', uploadPath: '/api/v3/upload', apiKeyHeader: 'Authorization', imageField: 'file', responseUrlField: 'data.url' },
  scdn: { baseUrl: 'https://img.scdn.io', uploadPath: '/api/v1.php', apiKeyOptional: true, imageField: 'image', imagePayloadType: 'file', responseUrlField: 'url' },
  catbox: { baseUrl: 'https://catbox.moe', uploadPath: '/user/api.php', apiKeyFormField: 'userhash', apiKeyOptional: true, imageField: 'fileToUpload', imagePayloadType: 'file', staticFormFields: { reqtype: 'fileupload' } },
};

export function normalizeImageHostProvider(provider: ImageHostProvider): ImageHostProvider {
  const defaults = PLATFORM_DEFAULTS[provider.platform];
  if (!defaults) return provider;
  if (provider.platform === 'catbox') return { ...provider, baseUrl: provider.baseUrl || defaults.baseUrl || '', uploadPath: provider.uploadPath || defaults.uploadPath || '', apiKeyFormField: 'userhash', apiKeyOptional: true, imageField: 'fileToUpload', imagePayloadType: 'file', staticFormFields: { ...(provider.staticFormFields || {}), reqtype: 'fileupload' }, responseUrlField: undefined, responseDeleteUrlField: undefined };
  if (provider.platform === 'scdn') return { ...provider, baseUrl: provider.baseUrl || defaults.baseUrl || '', uploadPath: provider.uploadPath || defaults.uploadPath || '', apiKeyOptional: true, imageField: 'image', imagePayloadType: 'file', responseUrlField: 'url', responseDeleteUrlField: undefined };
  if (provider.platform === 'imgbb') return { ...provider, baseUrl: provider.baseUrl || defaults.baseUrl || '', uploadPath: provider.uploadPath || defaults.uploadPath || '', apiKeyParam: defaults.apiKeyParam, expirationParam: defaults.expirationParam, imageField: defaults.imageField, nameField: defaults.nameField, responseUrlField: defaults.responseUrlField, responseDeleteUrlField: defaults.responseDeleteUrlField };
  if (provider.platform === 'imgurl') return { ...provider, baseUrl: provider.baseUrl || defaults.baseUrl || '', uploadPath: provider.uploadPath || defaults.uploadPath || '', apiKeyHeader: defaults.apiKeyHeader, imageField: provider.imageField || defaults.imageField, responseUrlField: provider.responseUrlField || defaults.responseUrlField };
  return provider;
}

export function normalizeImageHostProviders(providers: ImageHostProvider[] | undefined | null): ImageHostProvider[] {
  return (providers || []).filter(isVisibleImageHostProvider).map(normalizeImageHostProvider);
}
