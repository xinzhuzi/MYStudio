// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRemotionProjectFileSource } from "./remotion-audio-source-verification";

describe("verifyRemotionProjectFileSource", () => {
  it("accepts an in-root file with the declared SHA-256", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-source-"));
    const filePath = path.join(root, "remotion", "shots", "shot.mp4");
    const bytes = Buffer.from("shot-mp4", "utf8");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    try {
      const result = await verifyRemotionProjectFileSource(filePath, root, sha256, "shot_slot");
      expect(result).toMatchObject({ filePath: fs.realpathSync(filePath), sha256 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects byte drift before a capability can be created", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-source-"));
    const filePath = path.join(root, "shot.mp4");
    fs.writeFileSync(filePath, "changed", "utf8");
    try {
      await expect(verifyRemotionProjectFileSource(filePath, root, "a".repeat(64), "shot_slot"))
        .rejects.toThrow("shot_slot_sha256_mismatch");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes even when the lexical path is inside the project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-source-"));
    const outside = path.join(root, "outside");
    const link = path.join(root, "remotion", "shot.mp4");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(outside, "outside", "utf8");
    fs.symlinkSync(outside, link);
    try {
      await expect(verifyRemotionProjectFileSource(link, root, "b".repeat(64), "shot_slot"))
        .rejects.toThrow("path_escape");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
