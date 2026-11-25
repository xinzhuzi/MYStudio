// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  computeProjectFileSha256,
  isValidSha256Hex,
  sha256FromBase64Image,
} from "@/lib/studio/image-content-hash";

describe("sha256FromBase64Image", () => {
  it("裸 base64 与 data URL 同字节同哈希(hello 已知向量)", async () => {
    const expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    await expect(sha256FromBase64Image("aGVsbG8=")).resolves.toBe(expected);
    await expect(sha256FromBase64Image("data:image/png;base64,aGVsbG8=")).resolves.toBe(expected);
  });

  it("非法 base64 抛错(调用方转业务文案)", async () => {
    await expect(sha256FromBase64Image("%%%not-base64%%%")).rejects.toThrow();
  });
});

describe("isValidSha256Hex", () => {
  it("64 位小写 hex 通过", () => {
    expect(isValidSha256Hex("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")).toBe(true);
  });
  it.each([undefined, null, "", "abc", "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824"])(
    "非 64 位小写 hex %p 拒绝",
    (value) => {
      expect(isValidSha256Hex(value as string | undefined | null)).toBe(false);
    },
  );
});

describe("computeProjectFileSha256", () => {
  it("桥读成功返回哈希", async () => {
    const bridge = {
      readAsBase64: async () => ({ success: true, base64: "data:image/png;base64,aGVsbG8=" }),
    } as unknown as NonNullable<Window["projectFiles"]>;
    await expect(computeProjectFileSha256(bridge, "url")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
  it.each([
    { success: false, base64: "", error: "x" },
    { success: true, base64: "", error: "" },
    undefined,
  ])("桥读失败/空内容返回 undefined(%p)", async (reply) => {
    const bridge = {
      readAsBase64: async () => reply,
    } as unknown as NonNullable<Window["projectFiles"]>;
    await expect(computeProjectFileSha256(bridge, "url")).resolves.toBeUndefined();
  });
  it("桥抛错兜底 undefined 不上抛", async () => {
    const bridge = {
      readAsBase64: async () => {
        throw new Error("boom");
      },
    } as unknown as NonNullable<Window["projectFiles"]>;
    await expect(computeProjectFileSha256(bridge, "url")).resolves.toBeUndefined();
  });
});
