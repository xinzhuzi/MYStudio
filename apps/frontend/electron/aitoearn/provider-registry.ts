import type {
  SelfMediaAccount,
  SelfMediaDraft,
  SelfMediaPlatform,
  SelfMediaProviderId,
  SelfMediaProviderSummary,
  SelfMediaTask,
  SelfMediaTaskError,
  SelfMediaTaskStatus,
} from "../../types/self-media";

export interface SelfMediaResolvedAsset {
  assetId: string;
  url: string;
  kind: "video" | "image";
}

export interface SelfMediaProviderTaskResult {
  status?: SelfMediaTaskStatus;
  progress?: number;
  providerTaskId?: string;
  resultUrl?: string;
  error?: SelfMediaTaskError;
}

export interface SelfMediaProviderPublishContext {
  projectId: string;
  draft: SelfMediaDraft;
  task: SelfMediaTask;
  resolveAsset: (assetId: string) => Promise<SelfMediaResolvedAsset>;
  emitProgress: (progress: number) => void;
}

export interface SelfMediaProviderAdapter {
  readonly id: SelfMediaProviderId;
  readonly summary: SelfMediaProviderSummary;
  readonly publishMode: "per-account";
  listAccounts: (projectId: string) => Promise<SelfMediaAccount[]>;
  startLogin: (projectId: string, platform: SelfMediaPlatform) => Promise<{ started: boolean }>;
  publish: (context: SelfMediaProviderPublishContext) => Promise<SelfMediaProviderTaskResult>;
  poll: (task: SelfMediaTask) => Promise<SelfMediaProviderTaskResult>;
  cancel: (task: SelfMediaTask) => Promise<SelfMediaProviderTaskResult>;
  dispose: () => Promise<void>;
}

export class SelfMediaProviderError extends Error {
  constructor(
    readonly providerId: SelfMediaProviderId,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "SelfMediaProviderError";
  }
}

export interface AitoearnLocalPlatformBridge {
  readonly availablePlatforms?: readonly SelfMediaPlatform[];
  listAccounts: (projectId: string) => Promise<SelfMediaAccount[]>;
  startLogin: (projectId: string, platform: SelfMediaPlatform) => Promise<{ started: boolean }>;
  publish: (context: SelfMediaProviderPublishContext) => Promise<SelfMediaProviderTaskResult>;
  poll: (task: SelfMediaTask) => Promise<SelfMediaProviderTaskResult>;
  cancel: (task: SelfMediaTask) => Promise<SelfMediaProviderTaskResult>;
  dispose?: () => Promise<void>;
}

export function createAitoearnLocalAdapter(bridge?: AitoearnLocalPlatformBridge): SelfMediaProviderAdapter {
  const summary: SelfMediaProviderSummary = bridge
    ? { id: "aitoearn-local", displayName: "AiToEarn 本地适配器", enabled: true, availablePlatforms: [...(bridge.availablePlatforms ?? [])] }
    : { id: "aitoearn-local", displayName: "AiToEarn 本地适配器", enabled: false, reason: "本地平台适配器正在迁移" };

  const unavailable = () => {
    throw new SelfMediaProviderError(
      "aitoearn-local",
      "provider-disabled",
      summary.reason ?? "本地平台适配器未启用",
    );
  };

  return {
    id: "aitoearn-local",
    summary,
    publishMode: "per-account",
    listAccounts: bridge?.listAccounts ?? (async () => unavailable()),
    startLogin: bridge?.startLogin ?? (async () => unavailable()),
    publish: bridge?.publish ?? (async () => unavailable()),
    poll: bridge?.poll ?? (async () => unavailable()),
    cancel: bridge?.cancel ?? (async () => unavailable()),
    dispose: async () => bridge?.dispose?.(),
  };
}

export interface SelfMediaProviderRegistry {
  get: (providerId: SelfMediaProviderId) => SelfMediaProviderAdapter;
  list: () => SelfMediaProviderSummary[];
  dispose: () => Promise<void>;
}

export function createSelfMediaProviderRegistry(options: {
  local?: SelfMediaProviderAdapter;
} = {}): SelfMediaProviderRegistry {
  const adapters: Record<SelfMediaProviderId, SelfMediaProviderAdapter> = { "aitoearn-local": options.local ?? createAitoearnLocalAdapter() };
  return {
    get: (providerId) => adapters[providerId],
    list: () => Object.values(adapters).map((adapter) => ({ ...adapter.summary })),
    dispose: async () => {
      await Promise.all(Object.values(adapters).map((adapter) => adapter.dispose()));
    },
  };
}
