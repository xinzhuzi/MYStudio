export {
  PLATFORM_MANIFESTS,
  getPlatformManifest,
  listPlatformManifests,
} from "./platform-manifest";
export {
  createPlatformAdapterRegistry,
  type PlatformAdapterRegistry,
} from "./platform-registry";
export {
  createPlatformAdapter,
  PlatformAdapterError,
  type PlatformAccountInput,
  type PlatformAccountProjection,
  type PlatformAdapter,
  type PlatformAdapterTransport,
  type PlatformAuthenticationResult,
  type PlatformPublishRequest,
  type PlatformTaskInput,
  type PlatformTaskProjection,
} from "./platform-adapter";
export {
  AITOEARN_LOCAL_PROVIDER_ID,
  PLATFORM_IDS,
  type PlatformAccountStatus,
  type PlatformAuthStrategy,
  type PlatformCapabilities,
  type PlatformCapability,
  type PlatformCapabilityRoute,
  type PlatformCapabilityRouting,
  type PlatformContentType,
  type PlatformId,
  type PlatformManifest,
  type PlatformTaskStatus,
} from "./platform-types";
