import { describe, expect, it } from "vitest";
import { processMediaFiles as facadeProcess } from "./media-processing";
import type { ProcessedMediaItem as FacadeItem } from "./media-processing";
import {
  processMediaFiles as canonicalProcess,
  type ProcessedMediaItem as CanonicalItem,
} from "./media/media-processing";

describe("media-processing root facade", () => {
  it("re-exports the canonical processMediaFiles implementation", () => {
    expect(facadeProcess).toBe(canonicalProcess);
  });

  it("keeps the ProcessedMediaItem type export path available from the facade", () => {
    type _Check = FacadeItem extends CanonicalItem ? true : false;
    const ok: _Check = true;
    expect(ok).toBe(true);
  });
});
