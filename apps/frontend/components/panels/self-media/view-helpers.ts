import { SELF_MEDIA_CAPABILITY_MANIFEST } from "@/lib/self-media/capabilities";
import type { SelfMediaTask } from "@/types/self-media";

export function getSelfMediaBridge() {
  return typeof window === "undefined" ? undefined : window.selfMedia;
}

export function getProductBridge() {
  return typeof window === "undefined" ? undefined : window.productBridge;
}

export const selfMediaPlatformCapabilities = Object.values(SELF_MEDIA_CAPABILITY_MANIFEST);

export function isTerminalTaskStatus(status: SelfMediaTask["status"]): boolean {
  return ["success", "failure", "partial", "audit", "canceled", "expired-login"].includes(status);
}
