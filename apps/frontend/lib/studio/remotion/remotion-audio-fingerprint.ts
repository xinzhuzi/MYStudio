import type {
  RemotionChapterAudioBindingV2,
  RemotionChapterManifestV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import { sha256CanonicalJson } from "./canonical-json";
import type {
  RemotionValidationIssue,
  RemotionValidationResult,
} from "./remotion-validation-utils";

export type RemotionAudioBindingV2 =
  | RemotionShotAudioBindingV2
  | RemotionChapterAudioBindingV2;

export function remotionAudioBindingFingerprintInput(
  binding: RemotionAudioBindingV2,
): Omit<RemotionAudioBindingV2, "bindingFingerprint"> {
  const { bindingFingerprint: _bindingFingerprint, ...input } = binding;
  return input;
}

export async function createRemotionAudioBindingFingerprint(
  binding: RemotionAudioBindingV2,
): Promise<string> {
  return sha256CanonicalJson(remotionAudioBindingFingerprintInput(binding));
}

export async function validateRemotionAudioBindingFingerprint<T extends RemotionAudioBindingV2>(
  binding: T,
  path = "$",
): Promise<RemotionValidationResult<T>> {
  const expected = await createRemotionAudioBindingFingerprint(binding);
  if (binding.bindingFingerprint !== expected) {
    return failure(
      `${path}.bindingFingerprint`,
      "bindingFingerprint 与全部渲染字段的 canonical SHA-256 不一致",
      "remotion.audio.binding_fingerprint_mismatch",
    );
  }
  return { success: true, value: binding };
}

export function remotionChapterManifestFingerprintInput(
  manifest: RemotionChapterManifestV2,
): Omit<RemotionChapterManifestV2, "manifestFingerprint"> {
  const { manifestFingerprint: _manifestFingerprint, ...input } = manifest;
  return input;
}

export async function createRemotionChapterManifestFingerprint(
  manifest: RemotionChapterManifestV2,
): Promise<string> {
  return sha256CanonicalJson(remotionChapterManifestFingerprintInput(manifest));
}

export async function validateRemotionChapterManifestFingerprint(
  manifest: RemotionChapterManifestV2,
): Promise<RemotionValidationResult<RemotionChapterManifestV2>> {
  const issues: RemotionValidationIssue[] = [];
  for (let index = 0; index < manifest.sharedAudioBindings.length; index += 1) {
    const result = await validateRemotionAudioBindingFingerprint(
      manifest.sharedAudioBindings[index],
      `$.sharedAudioBindings[${index}]`,
    );
    if (!result.success) issues.push(...result.issues);
  }
  for (let shotIndex = 0; shotIndex < manifest.shots.length; shotIndex += 1) {
    const bindings = manifest.shots[shotIndex].audioBindings;
    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
      const result = await validateRemotionAudioBindingFingerprint(
        bindings[bindingIndex],
        `$.shots[${shotIndex}].audioBindings[${bindingIndex}]`,
      );
      if (!result.success) issues.push(...result.issues);
    }
  }
  const expected = await createRemotionChapterManifestFingerprint(manifest);
  if (manifest.manifestFingerprint !== expected) {
    issues.push({
      code: "remotion.chapter.manifest_fingerprint_mismatch",
      path: "$.manifestFingerprint",
      message: "manifestFingerprint 与全部章节渲染字段的 canonical SHA-256 不一致",
    });
  }
  return issues.length > 0 ? { success: false, issues } : { success: true, value: manifest };
}

function failure<T>(path: string, message: string, code: string): RemotionValidationResult<T> {
  return { success: false, issues: [{ path, message, code }] };
}
