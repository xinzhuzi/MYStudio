import type { RemotionRenderJobIdentityV1 } from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "./canonical-json";

export function remotionJobIdentityPayload(identity: RemotionRenderJobIdentityV1): object {
  return {
    projectId: identity.projectId,
    target: identity.target,
    inputHash: identity.inputHash,
    bundleContentHash: identity.bundleContentHash,
    renderSettingsHash: identity.renderSettingsHash,
  };
}

export async function createRemotionRenderJobId(identity: RemotionRenderJobIdentityV1): Promise<string> {
  const digest = await sha256CanonicalJson(remotionJobIdentityPayload(identity));
  return `${identity.target.kind}:${digest}`;
}
