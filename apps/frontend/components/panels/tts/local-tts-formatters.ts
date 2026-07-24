export function formatSizeMb(sizeMb?: number | null): string {
  if (!sizeMb) return "未知";
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(sizeMb >= 10 * 1024 ? 1 : 2)} GB`;
  return `${Math.round(sizeMb)} MB`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
