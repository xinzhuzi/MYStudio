// Compatibility facade for the Freedom model registry.
export type { BaseModel, ModelInput, T2IModel, T2VModel } from "./model-registry-types";
export { T2I_MODELS } from "./model-registry-t2i";
export { T2V_MODELS } from "./model-registry-t2v";
export {
  getAllT2IModels,
  getAllT2VModels,
  getAspectRatiosForT2IModel,
  getAspectRatiosForT2VModel,
  getDurationsForModel,
  getProviderModelId,
  getResolutionsForModel,
  getT2IModelById,
  getT2VModelById,
  resolveT2IModel,
  resolveT2VModel,
} from "./model-registry-query";
