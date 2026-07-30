import { sha256CanonicalJson } from "./canonical-json";

export {
  validateRemotionChapterManifest,
  validateRemotionWorkspaceManifest,
} from "./remotion-manifest-validation";
export {
  validateRemotionEvidence,
  validateRemotionEvidenceIdentity,
  validateRemotionRenderJob,
  validateRemotionRenderJobIdentity,
} from "./remotion-render-validation";
export {
  validateRemotionCurrentSlot,
  validateRemotionCurrentSlotCollection,
  validateRemotionCurrentSlotPublication,
} from "./remotion-slot-validation";
export {
  validateRemotionStudioSessionContract,
  validateRemotionStudioWriteRequest,
} from "./remotion-studio-session-validation";
export type {
  RemotionValidationIssue,
  RemotionValidationResult,
} from "./remotion-validation-utils";

export function canonicalRemotionWorkspaceHash(value: unknown): Promise<string> {
  return sha256CanonicalJson(value);
}
