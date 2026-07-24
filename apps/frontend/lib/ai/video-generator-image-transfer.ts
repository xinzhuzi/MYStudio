// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { uploadToImageHost, isImageHostConfigured } from '@/lib/image-host';
import { readImageAsBase64 } from '@/lib/image-storage';
import { prepareReferenceImageForTransfer } from '@/lib/ai/image-transfer';
import { normalizeUrl } from '@/lib/ai/video-response-utils';

interface ConvertToHttpUrlOptions {
  fallbackHttpUrl?: string | null;
  uploadName?: string;
}

/** Converts a local/base64 reference image to an HTTP URL accepted by video APIs. */
export async function convertToHttpUrl(
  rawUrl: unknown,
  options?: ConvertToHttpUrlOptions,
): Promise<string> {
  const url = typeof rawUrl === 'string' ? rawUrl : (Array.isArray(rawUrl) ? rawUrl[0] : '');
  const fallbackHttpUrl = typeof options?.fallbackHttpUrl === 'string' ? options.fallbackHttpUrl : '';
  if (!url) {
    if (fallbackHttpUrl.startsWith('http://') || fallbackHttpUrl.startsWith('https://')) return fallbackHttpUrl;
    console.warn('[VideoGen] convertToHttpUrl received invalid url:', rawUrl);
    return '';
  }

  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (!isImageHostConfigured()) throw new Error('图床未配置，请在设置中配置图床 API Key');

  let imageData = url;
  if (url.startsWith('local-image://')) {
    const base64 = await readImageAsBase64(url);
    if (!base64) throw new Error(`无法读取本地文件: ${url.substring(0, 40)}`);
    imageData = base64;
  }
  imageData = await prepareReferenceImageForTransfer(imageData);

  const result = await uploadToImageHost(imageData, {
    name: options?.uploadName?.trim() || `media_ref_${Date.now()}`,
    expiration: 15552000,
  });
  if (!result.success || !result.url) throw new Error(result.error || '图床上传失败');
  return result.url;
}

export async function buildImageWithRoles(
  firstFrameUrl: string | undefined,
  lastFrameUrl: string | undefined,
): Promise<Array<{ url: string; role: 'first_frame' | 'last_frame' }>> {
  const imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }> = [];

  if (firstFrameUrl) {
    const normalizedFirstFrame = normalizeUrl(firstFrameUrl) || '';
    const firstFrameConverted = await convertToHttpUrl(normalizedFirstFrame);
    if (firstFrameConverted) imageWithRoles.push({ url: firstFrameConverted, role: 'first_frame' });
  }

  if (lastFrameUrl) {
    const lastFrameConverted = await convertToHttpUrl(lastFrameUrl);
    if (lastFrameConverted) imageWithRoles.push({ url: lastFrameConverted, role: 'last_frame' });
  }

  return imageWithRoles;
}

export async function prepareVideoImageRolesForTransfer(
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
): Promise<Array<{ url: string; role: 'first_frame' | 'last_frame' }>> {
  const prepared: Array<{ url: string; role: 'first_frame' | 'last_frame' }> = [];
  for (const image of imageWithRoles) {
    prepared.push({ ...image, url: await prepareReferenceImageForTransfer(image.url) });
  }
  return prepared;
}
