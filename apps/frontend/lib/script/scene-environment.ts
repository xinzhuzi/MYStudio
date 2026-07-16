/** Scene location normalization and environment classification helpers. */

export type SceneEnvironmentType =
  | 'vehicle'
  | 'outdoor'
  | 'indoor_home'
  | 'indoor_work'
  | 'indoor_public'
  | 'ancient_indoor'
  | 'ancient_outdoor'
  | 'ancient_vehicle'
  | 'unknown';

export type EnvironmentKeywords = Record<SceneEnvironmentType, string[]>;

function cleanLocationString(location: string): string {
  let cleaned = location.replace(/\s*人物[：:].*/g, '');
  cleaned = cleaned.replace(/\s*角色[：:].*/g, '');
  cleaned = cleaned.replace(/\s*时间[：:].*/g, '');
  return cleaned.trim();
}

export function detectEnvironmentType(
  location: string,
  keywords: EnvironmentKeywords,
): SceneEnvironmentType {
  const cleanedLocation = cleanLocationString(location);
  const normalizedLocation = cleanedLocation.toLowerCase();
  console.log(`[detectEnvironmentType] 原始: "${location}" -> 清理后: "${cleanedLocation}"`);
  const priorities: SceneEnvironmentType[] = [
    'ancient_vehicle', 'ancient_indoor', 'ancient_outdoor',
    'vehicle', 'outdoor', 'indoor_public', 'indoor_work', 'indoor_home',
  ];
  for (const envType of priorities) {
    for (const keyword of keywords[envType]) {
      if (normalizedLocation.includes(keyword)) {
        console.log(`[detectEnvironmentType] 匹配到关键词 "${keyword}" -> 环境类型: ${envType}`);
        return envType;
      }
    }
  }
  console.log('[detectEnvironmentType] 未匹配到任何关键词 -> unknown');
  return 'unknown';
}
