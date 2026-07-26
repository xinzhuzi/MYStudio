import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A single preview/render media session.
 *
 * Each session owns a 256-bit capability token and a whitelist mapping
 * assetId -> absolute file path. URLs never contain local file names; the
 * route resolves only through this map, so path traversal is impossible.
 */
export interface MediaBridgeAsset {
  readonly assetId: string;
  readonly absolutePath: string;
}

/** Number of random bytes for a capability token (256-bit). */
const TOKEN_BYTES = 32;

/**
 * Validate a source path with the same semantics the FFmpeg host uses for
 * plan inputs: must be absolute, a regular file, non-empty and readable.
 * Throws on any violation so registration is fail-closed.
 */
export function assertServableFile(absolutePath: string): void {
  if (!path.isAbsolute(absolutePath)) {
    throw new Error(`媒体桥素材不是绝对路径: ${absolutePath}`);
  }
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`媒体桥素材不可读或为空: ${absolutePath}`);
  }
  fs.accessSync(absolutePath, fs.constants.R_OK);
}

/** Generate a 256-bit URL-safe capability token. */
export function createSessionToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

export class MediaBridgeSession {
  readonly token: string;
  private readonly assets = new Map<string, string>();
  private revoked = false;

  constructor(token: string = createSessionToken()) {
    this.token = token;
  }

  /**
   * Register an asset after validating it. Re-registering the same assetId with
   * an identical path is idempotent; a conflicting path throws.
   */
  register(assetId: string, absolutePath: string): void {
    if (this.revoked) {
      throw new Error("媒体桥 session 已撤销，无法注册素材");
    }
    if (!assetId) {
      throw new Error("媒体桥 assetId 不能为空");
    }
    assertServableFile(absolutePath);
    const existing = this.assets.get(assetId);
    if (existing !== undefined && existing !== absolutePath) {
      throw new Error(`媒体桥 assetId 已存在且路径冲突: ${assetId}`);
    }
    this.assets.set(assetId, absolutePath);
  }

  /** Resolve an assetId to its absolute path, or undefined if unknown/revoked. */
  resolve(assetId: string): string | undefined {
    if (this.revoked) {
      return undefined;
    }
    return this.assets.get(assetId);
  }

  get isRevoked(): boolean {
    return this.revoked;
  }

  get size(): number {
    return this.assets.size;
  }

  /** Revoke the session; subsequent resolves return undefined. */
  revoke(): void {
    this.revoked = true;
    this.assets.clear();
  }
}
