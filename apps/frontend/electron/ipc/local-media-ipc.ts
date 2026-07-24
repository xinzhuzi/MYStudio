import fs from "node:fs";
import http from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import path from "node:path";
import { ipcMain } from "electron";
import { parseLocalMediaPath, resolveLocalMediaPath } from "../storage-paths";

type RegisterLocalMediaIpcHandlersContext = {
  getMediaRoot: () => string;
};

const DEFAULT_LOCAL_MEDIA_MAX_BYTES = 512 * 1024 * 1024;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function getLocalMediaMaxBytes() {
  const configured = Number(process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_LOCAL_MEDIA_MAX_BYTES;
}

function createMediaSizeError(maxBytes: number) {
  return new Error(`Media file exceeds ${maxBytes} bytes`);
}

function parseRemoteMediaUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid media URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported media URL protocol");
  }
  return parsed;
}

function normalizeLocalMediaCategory(category: string) {
  const normalized = `${category ?? ""}`.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error("Invalid media category");
  }
  return normalized;
}

function getImagesDir(mediaRoot: string, subDir: string) {
  const imagesDir = path.join(mediaRoot, subDir);
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
  return imagesDir;
}

function getAvailableMediaFileName(targetDir: string, filename: string) {
  const safeName = path.basename(filename).replace(/[/\\:*?"<>|]/g, "_");
  const ext = path.extname(safeName);
  const baseName = path.basename(safeName, ext) || "media";
  let candidate = safeName || `media${ext || ".png"}`;
  let index = 1;
  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${baseName}_${index}${ext}`;
    index += 1;
  }
  return candidate;
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function getContentLength(headers: IncomingHttpHeaders) {
  const rawValue = getHeaderValue(headers, "content-length");
  if (!rawValue) return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getChunkByteLength(chunk: Buffer | string) {
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
}

function getBase64DecodedByteLength(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function downloadImage(url: string, filePath: string, maxRedirects = 5, maxBytes = getLocalMediaMaxBytes()): Promise<void> {
  const parsedUrl = parseRemoteMediaUrl(url);
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const requestProtocol = parsedUrl.protocol === "https:" ? https : http;
    let file: fs.WriteStream | null = null;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (file) {
        file.destroy();
        fs.unlink(filePath, () => undefined);
      }
      reject(error);
    };

    requestProtocol.get(parsedUrl, (response) => {
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUS_CODES.has(status)) {
        const redirectUrl = response.headers.location;
        response.resume();
        if (!redirectUrl) {
          fail(new Error("Redirect missing location"));
          return;
        }
        try {
          const nextUrl = parseRemoteMediaUrl(new URL(redirectUrl, parsedUrl).toString());
          downloadImage(nextUrl.toString(), filePath, maxRedirects - 1, maxBytes).then(resolve).catch(reject);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }

      if (status !== 200) {
        response.resume();
        fail(new Error(`Failed to download: ${status}`));
        return;
      }

      const contentLength = getContentLength(response.headers);
      if (contentLength !== null && contentLength > maxBytes) {
        response.resume();
        fail(createMediaSizeError(maxBytes));
        return;
      }

      file = fs.createWriteStream(filePath);
      let downloadedBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        downloadedBytes += getChunkByteLength(chunk);
        if (downloadedBytes > maxBytes) {
          response.destroy(createMediaSizeError(maxBytes));
          return;
        }
        file?.write(chunk);
      });
      response.on("end", () => {
        if (!settled) file?.end();
      });
      response.on("error", (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
      file.on("error", (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
      file.on("finish", () => {
        if (settled) return;
        settled = true;
        file?.close();
        resolve();
      });
    }).on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export function registerLocalMediaIpcHandlers({ getMediaRoot }: RegisterLocalMediaIpcHandlersContext) {
  ipcMain.handle("save-image", async (_event, payload: { url: string; category: string; filename: string }) => {
    try {
      const { url, filename } = payload;
      const category = normalizeLocalMediaCategory(payload.category);
      const imagesDir = getImagesDir(getMediaRoot(), category);
      const ext = path.extname(filename) || ".png";
      const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
      const filePath = path.join(imagesDir, safeName);

      if (url.startsWith("data:")) {
        const matches = url.match(/^data:[^;]+;base64,(.+)$/s);
        if (!matches) return { success: false, error: "Invalid data URL format" };
        const maxBytes = getLocalMediaMaxBytes();
        if (getBase64DecodedByteLength(matches[1]) > maxBytes) {
          return { success: false, error: createMediaSizeError(maxBytes).message };
        }
        const buffer = Buffer.from(matches[1], "base64");
        if (buffer.length > maxBytes) {
          return { success: false, error: createMediaSizeError(maxBytes).message };
        }
        if (buffer.length === 0) {
          return { success: false, error: "Decoded base64 data is empty (0 bytes)" };
        }
        fs.writeFileSync(filePath, buffer);
      } else {
        await downloadImage(url, filePath);
      }

      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        fs.unlinkSync(filePath);
        return { success: false, error: "Saved file is 0 bytes" };
      }
      return { success: true, localPath: `local-image://${category}/${safeName}` };
    } catch (error) {
      console.error("Failed to save image:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("get-image-path", async (_event, localPath: string) => {
    try {
      const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
      if (fs.existsSync(filePath)) return `file:///${filePath.replace(/\\/g, "/")}`;
    } catch {
      return null;
    }
    return null;
  });

  ipcMain.handle("delete-image", async (_event, localPath: string) => {
    try {
      const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("move-image", async (_event, payload: { localPath: string; category: string }) => {
    const { localPath } = payload;
    try {
      const parsed = parseLocalMediaPath(localPath);
      if (!parsed) return { success: false, error: "Invalid local media path" };
      const category = normalizeLocalMediaCategory(payload.category);
      if (parsed.category === category) return { success: true, localPath };

      const sourcePath = resolveLocalMediaPath(getMediaRoot(), localPath);
      if (!fs.existsSync(sourcePath)) return { success: false, error: "File not found" };
      const targetDir = getImagesDir(getMediaRoot(), category);
      const targetName = getAvailableMediaFileName(targetDir, parsed.filename);
      const targetPath = path.join(targetDir, targetName);
      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        fs.copyFileSync(sourcePath, targetPath);
        fs.unlinkSync(sourcePath);
      }
      return { success: true, localPath: `local-image://${category}/${targetName}` };
    } catch (error) {
      console.error("Failed to move image:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("read-image-base64", async (_event, localPath: string) => {
    try {
      const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
      if (!fs.existsSync(filePath)) return { success: false, error: "File not found" };
      const data = fs.readFileSync(filePath);
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const mimeType = mimeTypes[path.extname(filePath).toLowerCase()] || "image/png";
      return {
        success: true,
        base64: `data:${mimeType};base64,${data.toString("base64")}`,
        mimeType,
        size: data.length,
      };
    } catch (error) {
      console.error("Failed to read image:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("get-absolute-path", async (_event, localPath: string) => {
    try {
      const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
      if (fs.existsSync(filePath)) return filePath;
    } catch {
      return null;
    }
    return null;
  });
}
