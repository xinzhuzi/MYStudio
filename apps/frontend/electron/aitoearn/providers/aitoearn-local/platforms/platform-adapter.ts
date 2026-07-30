import type {
  PlatformAccountStatus,
  PlatformContentType,
  PlatformManifest,
  PlatformTaskStatus,
} from "./platform-types";

export interface PlatformAccountInput {
  readonly accountId: string;
  readonly displayName: string;
  readonly status: PlatformAccountStatus;
  readonly avatarUrl?: string;
}

export interface PlatformAccountProjection {
  readonly platformId: PlatformManifest["id"];
  readonly accountId: string;
  readonly displayName: string;
  readonly status: PlatformAccountStatus;
  readonly avatarUrl?: string;
}

export interface PlatformTaskInput {
  readonly taskId: string;
  readonly status: PlatformTaskStatus;
  readonly progress: number;
  readonly providerTaskId?: string;
  readonly resultUrl?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface PlatformTaskProjection {
  readonly platformId: PlatformManifest["id"];
  readonly taskId: string;
  readonly status: PlatformTaskStatus;
  readonly progress: number;
  readonly providerTaskId?: string;
  readonly resultUrl?: string;
  readonly error?: PlatformTaskInput["error"];
}

export interface PlatformAuthenticationResult {
  readonly authenticated: boolean;
}

export interface PlatformPublishAsset {
  readonly assetId: string;
  readonly kind: "video" | "image";
  readonly url: string;
}

export interface PlatformPublishRequest {
  readonly accountId: string;
  readonly contentType: PlatformContentType;
  readonly assets: readonly PlatformPublishAsset[];
  readonly cover?: PlatformPublishAsset;
  readonly title?: string;
  readonly description?: string;
  readonly topics?: readonly string[];
  readonly visibility?: "public" | "private" | "friends";
  readonly scheduledAt?: string;
  readonly options?: Readonly<Record<string, string | number | boolean>>;
}

export interface PlatformTaskRequest {
  readonly accountId: string;
  readonly taskId: string;
}

export interface PlatformAdapterTransport {
  readonly authenticate: () => Promise<PlatformAuthenticationResult>;
  readonly listAccounts: () => Promise<readonly PlatformAccountInput[]>;
  readonly publish: (request: PlatformPublishRequest) => Promise<PlatformTaskInput>;
  readonly poll: (request: PlatformTaskRequest) => Promise<PlatformTaskInput>;
  readonly cancel: (request: PlatformTaskRequest) => Promise<PlatformTaskInput>;
}

export class PlatformAdapterError extends Error {
  constructor(
    readonly platformId: PlatformManifest["id"],
    readonly operation: string,
    readonly code: "transport-unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PlatformAdapterError";
  }
}

export interface PlatformAdapter {
  readonly manifest: PlatformManifest;
  readonly authenticate: () => Promise<PlatformAuthenticationResult>;
  readonly listAccounts: () => Promise<readonly PlatformAccountProjection[]>;
  readonly publish: (request: PlatformPublishRequest) => Promise<PlatformTaskProjection>;
  readonly poll: (request: PlatformTaskRequest) => Promise<PlatformTaskProjection>;
  readonly cancel: (request: PlatformTaskRequest) => Promise<PlatformTaskProjection>;
  readonly projectAccount: (input: PlatformAccountInput) => PlatformAccountProjection;
  readonly projectTask: (input: PlatformTaskInput) => PlatformTaskProjection;
}

function unavailable<T>(manifest: PlatformManifest, operation: string): Promise<T> {
  return Promise.reject(new PlatformAdapterError(
    manifest.id,
    operation,
    "transport-unavailable",
    `${manifest.displayName} 的 ${operation} transport 未配置，已拒绝执行`,
  ));
}

export function createPlatformAdapter(
  manifest: PlatformManifest,
  transport?: PlatformAdapterTransport,
): PlatformAdapter {
  const authenticate = transport?.authenticate ?? (() => unavailable<PlatformAuthenticationResult>(manifest, "authenticate"));
  const listAccounts = transport?.listAccounts ?? (() => unavailable<readonly PlatformAccountInput[]>(manifest, "listAccounts"));
  const publish = transport?.publish ?? (() => unavailable<PlatformTaskInput>(manifest, "publish"));
  const poll = transport?.poll ?? (() => unavailable<PlatformTaskInput>(manifest, "poll"));
  const cancel = transport?.cancel ?? (() => unavailable<PlatformTaskInput>(manifest, "cancel"));

  const projectAccount = (input: PlatformAccountInput): PlatformAccountProjection => ({
    platformId: manifest.id,
    accountId: input.accountId,
    displayName: input.displayName,
    status: input.status,
    ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
  });

  const projectTask = (input: PlatformTaskInput): PlatformTaskProjection => ({
    platformId: manifest.id,
    taskId: input.taskId,
    status: input.status,
    progress: input.progress,
    ...(input.providerTaskId ? { providerTaskId: input.providerTaskId } : {}),
    ...(input.resultUrl ? { resultUrl: input.resultUrl } : {}),
    ...(input.error ? { error: { ...input.error } } : {}),
  });

  return {
    manifest,
    authenticate,
    listAccounts: async () => (await listAccounts()).map(projectAccount),
    publish: async (request) => projectTask(await publish(request)),
    poll: async (request) => projectTask(await poll(request)),
    cancel: async (request) => projectTask(await cancel(request)),
    projectAccount,
    projectTask,
  };
}
