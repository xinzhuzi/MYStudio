/**
 * @deprecated Import provider contracts, model routing, and API-key services from the canonical lib/ai modules.
 * This facade remains temporarily for external integrations that still use the legacy path.
 */
export type { IProvider, ModelCapability } from "./ai/core/providers/types";
export { DEFAULT_PROVIDERS } from "./ai/core/providers/defaults";
export { classifyModelByName } from "./ai/core/providers/model-capabilities";
export type { ModelApiFormat } from "./ai/core/providers/model-routing";
export { resolveImageApiFormat, resolveVideoApiFormat } from "./ai/core/providers/model-routing";
export { ApiKeyManager, clearAllManagers, getProviderKeyManager, updateProviderKeys } from "./ai/core/services/api-key-manager";
export { generateId, getApiKeyCount, maskApiKey, parseApiKeys } from "./ai/core/services/api-key-utils";
export {};
