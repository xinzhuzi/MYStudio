import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { ipcMain } from "electron";
import { parseLocalMediaPath, resolveLocalMediaPath } from "../storage-paths";

type RegisterLocalMediaIpcHandlersContext = {
  getMediaRoot: () => string;
};

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

function downloadImage(url: string, filePath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const requestProtocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(filePath);

    requestProtocol.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        file.close();
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, filePath, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }
      }

      if (status !== 200) {
        file.close();
        fs.unlink(filePath, () => undefined);
        reject(new Error(`Failed to download: ${status}`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (error) => {
      file.close();
      fs.unlink(filePath, () => undefined);
      reject(error);
    });
  });
}

export function registerLocalMediaIpcHandlers({ getMediaRoot }: RegisterLocalMediaIpcHandlersContext) {
  ipcMain.handle("save-image", async (_event, { url, category, filename }) => {
    try {
      const imagesDir = getImagesDir(getMediaRoot(), category);
      const ext = path.extname(filename) || ".png";
      const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
      const filePath = path.join(imagesDir, safeName);

      if (url.startsWith("data:")) {
        const matches = url.match(/^data:[^;]+;base64,(.+)$/s);
        if (!matches) return { success: false, error: "Invalid data URL format" };
        const buffer = Buffer.from(matches[1], "base64");
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
