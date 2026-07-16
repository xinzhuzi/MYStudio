import type { Protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveLocalMediaPath, resolveProjectFileUrl } from "./storage-paths";
import { resolveToonflowAssetPath } from "./studio-runtime-assets";

type ReadFile = (filePath: string) => Uint8Array;

interface ProtocolHandlerOptions {
  protocol: Protocol;
  getMediaRoot: () => string;
  getDataDir: () => string;
  getSkillsRoot: () => string;
  readFile?: ReadFile;
  resolveLocalMedia?: typeof resolveLocalMediaPath;
  resolveProjectFile?: typeof resolveProjectFileUrl;
  resolveToonflowAsset?: typeof resolveToonflowAssetPath;
}

export function registerPrivilegedSchemes(protocol: Protocol) {
  protocol.registerSchemesAsPrivileged([
    "local-image",
    "project-file",
    "studio-skill",
    "toonflow-asset",
  ].map((scheme) => ({
    scheme,
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  })));
}

export function getProtocolMimeType(filePath: string) {
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
  };
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export function registerProtocolHandlers({
  protocol,
  getMediaRoot,
  getDataDir,
  getSkillsRoot,
  readFile = fs.readFileSync,
  resolveLocalMedia = resolveLocalMediaPath,
  resolveProjectFile = resolveProjectFileUrl,
  resolveToonflowAsset = resolveToonflowAssetPath,
}: ProtocolHandlerOptions) {
  const respondWithFile = (filePath: string) => new Response(Uint8Array.from(readFile(filePath)).buffer, {
    headers: { "Content-Type": getProtocolMimeType(filePath) },
  });

  protocol.handle("local-image", async (request) => {
    try {
      return respondWithFile(resolveLocalMedia(getMediaRoot(), request.url));
    } catch (error) {
      console.error("Failed to load local image:", error);
      return new Response("Image not found", { status: 404 });
    }
  });

  protocol.handle("project-file", async (request) => {
    try {
      return respondWithFile(resolveProjectFile(getDataDir(), request.url));
    } catch (error) {
      console.error("Failed to load project file:", error);
      return new Response("File not found", { status: 404 });
    }
  });

  protocol.handle("studio-skill", async (request) => {
    try {
      const url = new URL(request.url);
      const relativePath = [url.hostname, ...url.pathname.split("/").filter(Boolean)]
        .map((part) => decodeURIComponent(part))
        .join("/");
      const skillsRoot = path.resolve(getSkillsRoot());
      const filePath = path.resolve(skillsRoot, relativePath);
      if (filePath !== skillsRoot && !filePath.startsWith(skillsRoot + path.sep)) {
        throw new Error("Studio skill file path escapes storage root");
      }
      return respondWithFile(filePath);
    } catch (error) {
      console.error("Failed to load studio skill file:", error);
      return new Response("File not found", { status: 404 });
    }
  });

  protocol.handle("toonflow-asset", async (request) => {
    try {
      return respondWithFile(resolveToonflowAsset(request.url));
    } catch (error) {
      console.error("Failed to load Toonflow asset:", error);
      return new Response("File not found", { status: 404 });
    }
  });
}
