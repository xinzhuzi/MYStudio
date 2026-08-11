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
  const priorities: SceneEnvironmentType[] = [
    'ancient_vehicle', 'ancient_indoor', 'ancient_outdoor',
    'vehicle', 'outdoor', 'indoor_public', 'indoor_work', 'indoor_home',
  ];
  for (const envType of priorities) {
    for (const keyword of keywords[envType]) {
      if (normalizedLocation.includes(keyword)) {
        return envType;
      }
    }
  }
  return 'unknown';
}
