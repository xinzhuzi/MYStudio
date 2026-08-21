// HyperFrames GitHub Registry 模板池(08-21,从 catalog.json 动态构建)
import catalogJson from "../../../../frontend/assets/hyperframes-registry/catalog.json";

const catalog = catalogJson as { version: number; total: number; items: Array<{ name: string; type: string; title: string; tags: string[] }> };

export const HYPERFRAMES_REGISTRY_TEMPLATE_IDS: readonly string[] = catalog.items.map((item) => "hy:" + item.name);

const TAG_INDEX: Record<string, string[]> = {};
for (const item of catalog.items) {
  for (const tag of item.tags) {
    const key = tag.toLowerCase();
    (TAG_INDEX[key] ??= []).push("hy:" + item.name);
  }
}

export function registryTemplatesByTag(tag: string): string[] {
  return TAG_INDEX[tag] ?? [];
}

export function isHyperframesRegistryTemplate(id: string): boolean {
  return HYPERFRAMES_REGISTRY_TEMPLATE_IDS.includes(id);
}
