/** Resolve composite Kling image IDs while preserving native video model IDs. */
export function resolveKlingModelName(model: string): string {
  const match = model.match(/^kling-image-(v.+)$/);
  return match ? `kling-${match[1]}` : model;
}
