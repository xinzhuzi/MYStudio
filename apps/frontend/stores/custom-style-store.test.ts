import { afterEach, describe, expect, it, vi } from "vitest";

describe("custom style store SSR storage", () => {
  const originalStorage = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: originalStorage,
    });
    vi.resetModules();
  });

  it("keeps store mutations safe when localStorage is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    vi.resetModules();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const { useCustomStyleStore } = await import("./custom-style-store");
      const folderId = useCustomStyleStore.getState().addFolder("SSR 风格");

      expect(folderId).toMatch(/^stylefolder_/);
      expect(useCustomStyleStore.getState().folders).toHaveLength(1);
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("keeps the persistence key and partialized payload stable", async () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: () => null,
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(() => null),
        length: 0,
      },
    });
    vi.resetModules();

    const { useCustomStyleStore } = await import("./custom-style-store");
    useCustomStyleStore.getState().selectStyle("selected-style");
    useCustomStyleStore.getState().addFolder("持久化风格");

    const persistedCall = setItem.mock.calls.find(([key]) => key === "mystudio-custom-styles");
    expect(persistedCall).toBeDefined();
    const persisted = JSON.parse(persistedCall?.[1] as string) as {
      version: number;
      state: Record<string, unknown>;
    };

    expect(persisted.version).toBe(0);
    expect(Object.keys(persisted.state).sort()).toEqual(["folders", "styles"]);
  });
});
