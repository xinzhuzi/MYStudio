import { describe, expect, it } from "vitest";
import {
  ApiKeyManager as facadeApiKeyManager,
  clearAllManagers as facadeClearAllManagers,
  getProviderKeyManager as facadeGetProviderKeyManager,
  updateProviderKeys as facadeUpdateProviderKeys,
  generateId as facadeGenerateId,
  getApiKeyCount as facadeGetApiKeyCount,
  maskApiKey as facadeMaskApiKey,
  parseApiKeys as facadeParseApiKeys,
  DEFAULT_PROVIDERS as facadeDefaultProviders,
  classifyModelByName as facadeClassifyModelByName,
  resolveImageApiFormat as facadeResolveImageApiFormat,
  resolveVideoApiFormat as facadeResolveVideoApiFormat,
} from "./api-key-manager";
import {
  ApiKeyManager as canonicalApiKeyManager,
  clearAllManagers as canonicalClearAllManagers,
  getProviderKeyManager as canonicalGetProviderKeyManager,
  updateProviderKeys as canonicalUpdateProviderKeys,
} from "./ai/core/services/api-key-manager";
import {
  generateId as canonicalGenerateId,
  getApiKeyCount as canonicalGetApiKeyCount,
  maskApiKey as canonicalMaskApiKey,
  parseApiKeys as canonicalParseApiKeys,
} from "./ai/core/services/api-key-utils";
import { DEFAULT_PROVIDERS as canonicalDefaultProviders } from "./ai/core/providers/defaults";
import { classifyModelByName as canonicalClassifyModelByName } from "./ai/core/providers/model-capabilities";
import {
  resolveImageApiFormat as canonicalResolveImageApiFormat,
  resolveVideoApiFormat as canonicalResolveVideoApiFormat,
} from "./ai/core/providers/model-routing";

describe("api-key-manager root facade", () => {
  it("re-exports the same API-key service helpers as the canonical ai modules", () => {
    expect(facadeApiKeyManager).toBe(canonicalApiKeyManager);
    expect(facadeClearAllManagers).toBe(canonicalClearAllManagers);
    expect(facadeGetProviderKeyManager).toBe(canonicalGetProviderKeyManager);
    expect(facadeUpdateProviderKeys).toBe(canonicalUpdateProviderKeys);
    expect(facadeGenerateId).toBe(canonicalGenerateId);
    expect(facadeGetApiKeyCount).toBe(canonicalGetApiKeyCount);
    expect(facadeMaskApiKey).toBe(canonicalMaskApiKey);
    expect(facadeParseApiKeys).toBe(canonicalParseApiKeys);
  });

  it("re-exports the same provider defaults and model-routing helpers", () => {
    expect(facadeDefaultProviders).toBe(canonicalDefaultProviders);
    expect(facadeClassifyModelByName).toBe(canonicalClassifyModelByName);
    expect(facadeResolveImageApiFormat).toBe(canonicalResolveImageApiFormat);
    expect(facadeResolveVideoApiFormat).toBe(canonicalResolveVideoApiFormat);
  });
});
