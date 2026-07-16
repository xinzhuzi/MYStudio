/** Pure response normalization helpers for image generation providers. */

export function normalizeResponseUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) return normalizeResponseUrl(value[0]);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function toDataImageUrl(b64: unknown, format: unknown): string | undefined {
  if (typeof b64 !== 'string' || !b64.trim()) return undefined;
  if (b64.startsWith('data:image/')) return b64;
  const rawFormat = typeof format === 'string' ? format.toLowerCase().replace(/[^a-z0-9.+-]/g, '') : '';
  const imageFormat = rawFormat === 'jpg' ? 'jpeg' : rawFormat || 'png';
  return `data:image/${imageFormat};base64,${b64}`;
}

export function getFirstDataItem(data: any): any {
  const dataField = data?.data;
  return Array.isArray(dataField) ? dataField[0] : dataField;
}

export function extractDirectImageUrl(data: any): string | undefined {
  const firstItem = getFirstDataItem(data);
  return normalizeResponseUrl(firstItem?.url)
    || normalizeResponseUrl(firstItem?.image_url)
    || normalizeResponseUrl(firstItem?.output_url)
    || normalizeResponseUrl(data?.url)
    || normalizeResponseUrl(data?.image_url)
    || normalizeResponseUrl(data?.output_url)
    || toDataImageUrl(firstItem?.b64_json ?? data?.b64_json, firstItem?.output_format ?? data?.output_format);
}
