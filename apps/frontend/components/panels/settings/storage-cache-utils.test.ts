// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isPersistedSettingsKey } from "./storage-cache-utils";

describe("storage cache utilities", () => {
  it("matches only persisted application and store keys", () => {
    expect(isPersistedSettingsKey("mystudio-project-store")).toBe(true);
    expect(isPersistedSettingsKey("moyin-creator-settings")).toBe(true);
    expect(isPersistedSettingsKey("custom-store-cache")).toBe(true);
    expect(isPersistedSettingsKey("unrelated-preference")).toBe(false);
  });
});
