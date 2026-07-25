import type { BaseModel, T2IModel, T2VModel } from "./model-registry-types";
import { T2I_MODELS } from "./model-registry-t2i";
import { T2V_MODELS } from "./model-registry-t2v";

const t2iIndex = new Map<string, T2IModel>(
  T2I_MODELS.map((m) => [m.id, m]),
);

const t2vIndex = new Map<string, T2VModel>(
  T2V_MODELS.map((m) => [m.id, m]),
);

// ---------------------------------------------------------------------------
// §6  Helper / Query Functions
// ---------------------------------------------------------------------------

/** Retrieve a T2I model by its unique id. */
export function getT2IModelById(id: string): T2IModel | undefined {
  return t2iIndex.get(id) ?? t2iAliasIndex.get(id);
}

/** Retrieve a T2V model by its unique id. */
export function getT2VModelById(id: string): T2VModel | undefined {
  return t2vIndex.get(id) ?? t2vAliasIndex.get(id);
}

/** Return the supported aspect-ratio strings for a T2I model, or [] if none. */
export function getAspectRatiosForT2IModel(modelId: string): string[] {
  const model = t2iIndex.get(modelId) ?? t2iAliasIndex.get(modelId);
  if (!model) return [];
  const ar = model.inputs['aspect_ratio'];
  return (ar?.enum as string[] | undefined) ?? [];
}

/** Return the supported aspect-ratio strings for a T2V model, or [] if none. */
export function getAspectRatiosForT2VModel(modelId: string): string[] {
  const model = t2vIndex.get(modelId) ?? t2vAliasIndex.get(modelId);
  if (!model) return [];
  const ar = model.inputs['aspect_ratio'];
  return (ar?.enum as string[] | undefined) ?? [];
}

/** Return the supported duration values (in seconds) for a T2V model. */
export function getDurationsForModel(modelId: string): number[] {
  const model = t2vIndex.get(modelId) ?? t2vAliasIndex.get(modelId);
  if (!model) return [];
  const dur = model.inputs['duration'];
  if (!dur) return [];
  if (dur.enum) return dur.enum as number[];
  if (dur.default !== undefined) return [dur.default as number];
  return [];
}

/** Return the supported resolution strings for a T2V model. */
export function getResolutionsForModel(modelId: string): string[] {
  // Check T2V first, then T2I (some T2I models also have resolution)
  const model = t2vIndex.get(modelId) ?? t2vAliasIndex.get(modelId) ?? t2iIndex.get(modelId) ?? t2iAliasIndex.get(modelId);
  if (!model) return [];
  const res = model.inputs['resolution'];
  return (res?.enum as string[] | undefined) ?? [];
}

/** Return all registered T2I models. */
export function getAllT2IModels(): T2IModel[] {
  return T2I_MODELS;
}

/** Return all registered T2V models. */
export function getAllT2VModels(): T2VModel[] {
  return T2V_MODELS;
}

// ---------------------------------------------------------------------------
// §7  Provider Alias Resolution (bridge registry ↔ provider model IDs)
// ---------------------------------------------------------------------------

/** Build a reverse index: registryId/alias → registry model (O(1) lookup) */
function buildAliasIndex<T extends BaseModel>(models: T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const m of models) {
    index.set(m.id, m);
    for (const alias of m.providerAliases ?? []) {
      index.set(alias, m);
    }
  }
  return index;
}

const t2iAliasIndex = buildAliasIndex(T2I_MODELS);
const t2vAliasIndex = buildAliasIndex(T2V_MODELS);

/** Resolve a provider model ID to its registry T2I model definition. */
export function resolveT2IModel(providerModelId: string): T2IModel | undefined {
  return t2iAliasIndex.get(providerModelId);
}

/** Resolve a provider model ID to its registry T2V model definition. */
export function resolveT2VModel(providerModelId: string): T2VModel | undefined {
  return t2vAliasIndex.get(providerModelId);
}

/** Get the preferred provider model ID for API calls (first alias, or id as fallback). */
export function getProviderModelId(model: BaseModel): string {
  return model.providerAliases?.[0] ?? model.id;
}
