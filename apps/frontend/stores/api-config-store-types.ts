import type { ProviderId, ServiceType } from "@opencut/ai-core";
import type { IProvider } from "@/lib/api-key-manager";
import type { DiscoveredModelLimits } from "@/lib/ai/model-registry";
import type { AIFeature, FeatureBindings } from "@/lib/ai/feature-definitions";
import type { ModelBinding } from "@/types/studio";
import type { ImageHostPlatform, ImageHostProvider } from "./api-config-image-host";
import type {
  AgentDeploymentConfig,
  AgentDeploymentKey,
  AgentUseMode,
  ProviderAdapterCode,
  ProviderAdapterValidationResult,
  ResolvedAgentModel,
} from "./api-config-agent-deployments";

export interface AdvancedGenerationOptions {
  /** 启用视觉连续性：自动将上一分镜尾帧传递给下一分镜作为参考 */
  enableVisualContinuity: boolean;
  /** 启用断点续传：批量生成中断后可从上次位置继续 */
  enableResumeGeneration: boolean;
  /** 启用内容审核容错：遇到敏感内容自动跳过，继续生成其他分镜 */
  enableContentModeration: boolean;
  /** 启用多模型自动切换：首分镜使用 t2v，后续使用 i2v */
  enableAutoModelSwitch: boolean;
}


/** 高级选项默认值 */
export const DEFAULT_ADVANCED_OPTIONS: AdvancedGenerationOptions = {
  enableVisualContinuity: true,
  enableResumeGeneration: true,
  enableContentModeration: true,
  enableAutoModelSwitch: false,
};

/** Legacy 图床配置（仅用于迁移） */
export interface LegacyImageHostConfig {
  type: ImageHostPlatform;
  imgbbApiKey: string;
  cloudflareR2?: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  };
  custom?: {
    uploadUrl: string;
    apiKey: string;
  };
}

export interface APIConfigState {
  // Provider-based storage (v2)
  providers: IProvider[];

  // Toonflow-style workflow model deployment config
  agentUseMode: AgentUseMode;
  agentDeployments: AgentDeploymentConfig[];
  providerAdapterCodes: ProviderAdapterCode[];
  studioBindingsMigrated: boolean;
  
  // Feature bindings - which provider to use for each feature
  featureBindings: FeatureBindings;
  
  // Legacy: API Keys (v1, for migration)
  apiKeys: Partial<Record<ProviderId, string>>;
  
  // Concurrency control
  concurrency: number;
  
  // Aspect ratio preference
  aspectRatio: '16:9' | '9:16';
  orientation: 'landscape' | 'portrait';
  
  // Advanced generation options
  advancedOptions: AdvancedGenerationOptions;
  
  // Image host providers (independent mapping)
  imageHostProviders: ImageHostProvider[];
  
  // Model endpoint types from API sync (model ID -> supported_endpoint_types)
  modelEndpointTypes: Record<string, string[]>;
  
  // Model metadata from /api/pricing_new (MemeFast platform classification)
  // model_name -> model_type: "文本" | "图像" | "音视频" | "检索"
  modelTypes: Record<string, string>;
  // model_name -> tags: ["对话","识图","工具"] etc.
  modelTags: Record<string, string[]>;
  // model_name -> enable_groups: ["官转","纯AZ","default"] (MemeFast only)
  modelEnableGroups: Record<string, string[]>;
  
  // Discovered model limits (Error-driven Discovery)
  // model_name -> { maxOutput?, contextWindow?, discoveredAt }
  discoveredModelLimits: Record<string, DiscoveredModelLimits>;

  // 用户为每个模型显式配置的「思考模式」开关（覆盖按名字的自动判断）
  // model_name -> true(强制开) | false(强制关)；未配置则回退到 supportsThinking(model)
  modelThinkingOverrides: Record<string, boolean>;
}

export interface APIConfigActions {
  // Provider management (v2)
  addProvider: (provider: Omit<IProvider, 'id'>) => IProvider;
  updateProvider: (provider: IProvider) => void;
  removeProvider: (id: string) => void;
  getProviderByPlatform: (platform: string) => IProvider | undefined;
  getProviderById: (id: string) => IProvider | undefined;
  syncProviderModels: (providerId: string) => Promise<{ success: boolean; count: number; error?: string }>;

  // Toonflow-style workflow model deployment config
  setAgentUseMode: (mode: AgentUseMode) => void;
  setAgentDeployment: (deployment: Partial<AgentDeploymentConfig> & Pick<AgentDeploymentConfig, 'key'>) => void;
  getResolvedAgentModel: (key: AgentDeploymentKey) => ResolvedAgentModel | null;
  migrateStudioBindings: (bindings: ModelBinding[]) => { migrated: boolean; count: number };
  upsertProviderAdapterCode: (providerId: string, code: string) => ProviderAdapterValidationResult;
  validateProviderAdapterCode: (providerId: string) => ProviderAdapterValidationResult;
  syncModelsFromProviderAdapterCode: (providerId: string) => { success: boolean; count: number; error?: string };
  
  // Feature binding management (multi-select)
  setFeatureBindings: (feature: AIFeature, bindings: string[] | null) => void;
  toggleFeatureBinding: (feature: AIFeature, binding: string) => void;
  getFeatureBindings: (feature: AIFeature) => string[];
  getProvidersForFeature: (feature: AIFeature) => Array<{ provider: IProvider; model: string }>;
  isFeatureConfigured: (feature: AIFeature) => boolean;
  // Legacy single-select compat (deprecated)
  setFeatureBinding: (feature: AIFeature, providerId: string | null) => void;
  getFeatureBinding: (feature: AIFeature) => string | null;
  getProviderForFeature: (feature: AIFeature) => IProvider | undefined;
  
  // Legacy API Key management (v1 compat)
  setApiKey: (provider: ProviderId, key: string) => void;
  getApiKey: (provider: ProviderId) => string;
  clearApiKey: (provider: ProviderId) => void;
  clearAllApiKeys: () => void;
  
  // Concurrency
  setConcurrency: (n: number) => void;
  
  // Aspect ratio
  setAspectRatio: (ratio: '16:9' | '9:16') => void;
  toggleOrientation: () => void;
  
  // Advanced generation options
  setAdvancedOption: <K extends keyof AdvancedGenerationOptions>(key: K, value: AdvancedGenerationOptions[K]) => void;
  resetAdvancedOptions: () => void;
  
  // Image host provider management
  addImageHostProvider: (provider: Omit<ImageHostProvider, 'id'>) => ImageHostProvider;
  updateImageHostProvider: (provider: ImageHostProvider) => void;
  removeImageHostProvider: (id: string) => void;
  getImageHostProviderById: (id: string) => ImageHostProvider | undefined;
  getEnabledImageHostProviders: () => ImageHostProvider[];
  isImageHostConfigured: () => boolean;
  
  // Validation
  isConfigured: (provider: ProviderId) => boolean;
  isPlatformConfigured: (platform: string) => boolean;
  checkRequiredKeys: (services: ServiceType[]) => APIConfigStatus;
  checkChatKeys: () => APIConfigStatus;
  checkVideoGenerationKeys: () => APIConfigStatus;
  
  // Display helpers
  maskApiKey: (key: string) => string;
  getAllConfigs: () => { provider: ProviderId; configured: boolean; masked: string }[];
  
  // Model limits discovery
  getDiscoveredModelLimits: (model: string) => DiscoveredModelLimits | undefined;
  setDiscoveredModelLimits: (model: string, limits: Partial<DiscoveredModelLimits>) => void;

  // Per-model thinking-mode override（设置里手动标记「思考模式」）
  getModelThinkingOverride: (model: string) => boolean | undefined;
  setModelThinkingOverride: (model: string, enabled: boolean | undefined) => void;
}

export type APIConfigStore = APIConfigState & APIConfigActions;

// ==================== Status Type ====================

export interface APIConfigStatus {
  isAllConfigured: boolean;
  missingKeys: string[];
  friendlyMessage: string;
}


