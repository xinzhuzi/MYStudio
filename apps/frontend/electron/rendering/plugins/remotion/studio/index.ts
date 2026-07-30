export {
  CHAPTER_STUDIO_PROJECTION_SCHEMA_VERSION,
  generateChapterStudioProjection,
  parseChapterStudioProjection,
  type ChapterStudioProjectionClip,
  type ChapterStudioProjectionInput,
  type ChapterStudioProjectionParseResult,
} from "./chapter-studio-projection";
export {
  SUPPORTED_REMOTION_STUDIO_VERSION,
  assertSupportedRemotionStudioInternals,
  readRemotionStudioVersions,
  startLoopbackRemotionStudioServer,
  type LoopbackStudioServer,
  type RemotionStudioInternalStartOptions,
} from "./remotion-studio-internals";
export {
  RemotionStudioService,
  resolveProjectFixedStudioEntryPoint,
  type RemotionStudioSession,
  type RemotionStudioSessionIdentity,
} from "./remotion-studio-service";
export {
  buildMinimalRemotionStudioStartOptions,
  RemotionStudioRenderQueueBridge,
  type MinimalRemotionStudioStartOptionsInput,
  type RemotionStudioChapterRenderContext,
  type RemotionStudioRenderQueueBridgeOptions,
} from "./remotion-studio-start-options";
export {
  applyChapterStudioProjectionToEditingProject,
  watchChapterStudioProjection,
  type ChapterStudioProjectionWatcher,
  type ChapterStudioWritebackResult,
} from "./chapter-studio-writeback";
export {
  StudioAuthProxy,
  createStudioAuthToken,
  isLoopbackAddress,
  isStudioProxyUrlAllowed,
} from "./studio-auth-proxy";
export {
  createReadyRemotionChapterJob,
  createRemotionChapterRenderIdentity,
  type RemotionChapterRenderIdentity,
} from "../renderer/remotion-chapter-renderer";
