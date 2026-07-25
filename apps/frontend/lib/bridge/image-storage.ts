export type ImageStorageBridge = NonNullable<Window["imageStorage"]>;
export function getImageStorageBridge(): ImageStorageBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.imageStorage;
}
