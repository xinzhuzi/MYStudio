/** Pure scene-header parsing and location normalization helpers. */

export function extractLocationFromHeader(header: string): string {
  const parts = header.split(/\s+/);
  const locationParts = parts.filter((part) =>
    !/^\d+-\d+$/.test(part) &&
    !/^(日|夜|晨|暮|黄昏|黎明)$/.test(part) &&
    !/^(内|外|内\/外)$/.test(part),
  );
  return locationParts.join(' ') || header;
}

export function extractTimeFromHeader(header: string): string {
  const match = header.match(/(日|夜|晨|暮|黄昏|黎明|清晨|傍晚)/);
  return match ? match[1] : '日';
}

export function cleanLocationString(location: string): string {
  if (!location) return '';
  return location
    .replace(/\s*人物[\uff1a:].*/g, '')
    .replace(/\s*角色[\uff1a:].*/g, '')
    .replace(/\s*时间[\uff1a:].*/g, '')
    .trim();
}

export function normalizeLocation(location: string): string {
  return cleanLocationString(location)
    .replace(/\s+/g, '')
    .replace(/[\uff08\uff09()]/g, '')
    .toLowerCase();
}
