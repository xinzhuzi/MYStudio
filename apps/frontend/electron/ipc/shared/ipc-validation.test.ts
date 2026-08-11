import { describe, it, expect, vi, beforeEach } from "vitest";

// 用 vi.hoisted 提升共享状态,使 mock 工厂和测试体都能访问
const { handlers, ipcMainMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMainMock = {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
  return { handlers, ipcMainMock };
});

vi.mock("electron", () => ({ ipcMain: ipcMainMock }));

import {
  assertValid,
  assertValidAsync,
  createValidatedHandler,
  createAsyncValidatedHandler,
  IpcValidationError,
  validateEmptyRequest,
  validatePassthrough,
  type ValidationResult,
} from "./ipc-validation";

/** 触发已注册的 handler(模拟 renderer 调用) */
function invoke(channel: string, payload: unknown): unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, payload);
}

describe("ipc-validation", () => {
  beforeEach(() => {
    handlers.clear();
  });

  describe("assertValid", () => {
    it("成功时返回 value", () => {
      const result: ValidationResult<string> = {
        success: true,
        value: "ok",
      };
      expect(assertValid(result)).toBe("ok");
    });

    it("失败时抛 IpcValidationError 并携带 issues", () => {
      const result: ValidationResult<never> = {
        success: false,
        issues: [
          { path: "name", message: "required" },
          { path: "id", message: "must be number" },
        ],
      };
      try {
        assertValid(result);
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(IpcValidationError);
        const e = err as IpcValidationError;
        expect(e.issues).toHaveLength(2);
        expect(e.message).toContain("name: required");
        expect(e.message).toContain("id: must be number");
      }
    });

    it("空 issues 也抛错(默认消息)", () => {
      try {
        assertValid({ success: false, issues: [] });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(IpcValidationError);
        expect((err as Error).message).toContain("validation failed");
      }
    });
  });

  describe("assertValidAsync", () => {
    it("解析 Promise 后返回 value", async () => {
      const value = await assertValidAsync(
        Promise.resolve({ success: true as const, value: 42 }),
      );
      expect(value).toBe(42);
    });

    it("解析失败 Promise 时抛错", async () => {
      await expect(
        assertValidAsync(
          Promise.resolve({
            success: false,
            issues: [{ path: "$", message: "bad" }],
          }),
        ),
      ).rejects.toBeInstanceOf(IpcValidationError);
    });
  });

  describe("createValidatedHandler", () => {
    it("payload 合法时调用 handler 并返回结果", async () => {
      const validate = (p: unknown): ValidationResult<{ id: number }> =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as { id?: unknown }).id === "number"
          ? { success: true, value: { id: (p as { id: number }).id } }
          : {
              success: false,
              issues: [{ path: "id", message: "must be number" }],
            };

      const handler = vi.fn(
        async (_event, request: { id: number }) => `saved-${request.id}`,
      );

      createValidatedHandler("test-channel", validate, handler);

      const result = await invoke("test-channel", { id: 5 });
      expect(handler).toHaveBeenCalledWith({}, { id: 5 });
      expect(result).toBe("saved-5");
    });

    it("payload 非法时抛 IpcValidationError 且不调用 handler", async () => {
      const validate = (): ValidationResult<never> => ({
        success: false,
        issues: [{ path: "name", message: "required" }],
      });
      const handler = vi.fn();

      createValidatedHandler("bad-channel", validate, handler);

      await expect(invoke("bad-channel", {})).rejects.toBeInstanceOf(
        IpcValidationError,
      );
      expect(handler).not.toHaveBeenCalled();
    });

    it("向 ipcMain.handle 注册了 channel", () => {
      const spy = vi.spyOn(ipcMainMock, "handle");
      createValidatedHandler("spy-channel", validatePassthrough, () => null);
      expect(spy).toHaveBeenCalledWith("spy-channel", expect.any(Function));
    });
  });

  describe("createAsyncValidatedHandler", () => {
    it("异步 validate 通过后调用 handler", async () => {
      const validate = async (
        p: unknown,
      ): Promise<ValidationResult<{ x: string }>> =>
        Promise.resolve({
          success: true,
          value: { x: String(p ?? "") },
        });

      createAsyncValidatedHandler(
        "async-channel",
        validate,
        async (_e, r: { x: string }) => r.x.toUpperCase(),
      );

      const result = await invoke("async-channel", "hi");
      expect(result).toBe("HI");
    });

    it("异步 validate 失败时抛错", async () => {
      const validate = async (): Promise<ValidationResult<never>> =>
        Promise.resolve({
          success: false,
          issues: [{ path: "$", message: "nope" }],
        });

      createAsyncValidatedHandler("async-bad", validate, () => null);

      await expect(invoke("async-bad", {})).rejects.toBeInstanceOf(
        IpcValidationError,
      );
    });
  });

  describe("辅助 validate 函数", () => {
    it("validateEmptyRequest 永远成功返回 null", () => {
      expect(validateEmptyRequest(null)).toEqual({
        success: true,
        value: null,
      });
      expect(validateEmptyRequest({})).toEqual({
        success: true,
        value: null,
      });
    });

    it("validatePassthrough 透传 payload", () => {
      expect(validatePassthrough({ a: 1 })).toEqual({
        success: true,
        value: { a: 1 },
      });
    });
  });
});
