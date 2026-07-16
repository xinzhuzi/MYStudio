import { describe, expect, it, vi } from "vitest";
import type { FreedomVideoRoute } from "./freedom-routing";
import {
  runFreedomVideoRoute,
  type FreedomVideoRouteHandler,
  type FreedomVideoRouteHandlers,
} from "./freedom-video-dispatch";

describe("runFreedomVideoRoute", () => {
  it.each<FreedomVideoRoute>([
    "openai_official",
    "unified",
    "volc",
    "wan",
    "kling",
    "replicate",
  ])("dispatches %s to exactly its registered handler", async (route) => {
    const createHandler = (key: FreedomVideoRoute) => (
      vi.fn<Parameters<FreedomVideoRouteHandler>, ReturnType<FreedomVideoRouteHandler>>()
        .mockResolvedValue({ url: `https://${key}.test/video.mp4` })
    );
    const handlers: FreedomVideoRouteHandlers = {
      openai_official: createHandler("openai_official"),
      unified: createHandler("unified"),
      volc: createHandler("volc"),
      wan: createHandler("wan"),
      kling: createHandler("kling"),
      replicate: createHandler("replicate"),
    };
    const params = { prompt: "test prompt", duration: 5 };

    const result = await runFreedomVideoRoute(
      route,
      handlers,
      params,
      "video-model",
      "api-key",
      "https://api.test",
    );

    expect(result.url).toBe(`https://${route}.test/video.mp4`);
    expect(handlers[route]).toHaveBeenCalledWith(
      params,
      "video-model",
      "api-key",
      "https://api.test",
    );
    for (const [key, handler] of Object.entries(handlers)) {
      expect(handler).toHaveBeenCalledTimes(key === route ? 1 : 0);
    }
  });
});
