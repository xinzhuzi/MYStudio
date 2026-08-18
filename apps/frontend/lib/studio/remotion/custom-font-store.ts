// 自定义字幕字体存储（纯 fs/path，无 electron 依赖）——主进程 IPC 与
// 渲染主机/独立工具共用。目录自管于 <userData>/SubtitleFonts/。

import fs from "node:fs";
import path from "node:path";

import {
  customFontFamilyForId,
  customSubtitleFontIdForFileName,
  isCustomSubtitleFontId,
} from "./subtitle-fonts";

export interface CustomSubtitleFontEntry {
  id: string;
  label: string;
  family: string;
  fileName: string;
  sizeBytes: number;
}

const ALLOWED_EXTENSIONS = [".ttf", ".otf", ".woff2"] as const;

export function isAllowedFontFileName(fileName: string): boolean {
  return ALLOWED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
}

export function customFontsDir(userDataPath: string): string {
  return path.join(userDataPath, "SubtitleFonts");
}

export function listCustomSubtitleFonts(userDataPath: string): CustomSubtitleFontEntry[] {
  const dir = customFontsDir(userDataPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(isAllowedFontFileName)
    .map((fileName) => {
      const id = customSubtitleFontIdForFileName(fileName);
      return {
        id,
        label: id.slice("custom:".length),
        family: customFontFamilyForId(id),
        fileName,
        sizeBytes: fs.statSync(path.join(dir, fileName)).size,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function customFontAbsolutePath(userDataPath: string, fontId: string): string | undefined {
  if (!isCustomSubtitleFontId(fontId)) return undefined;
  const dir = customFontsDir(userDataPath);
  if (!fs.existsSync(dir)) return undefined;
  const match = fs.readdirSync(dir).find(
    (name) => isAllowedFontFileName(name) && customSubtitleFontIdForFileName(name) === fontId,
  );
  return match ? path.join(dir, match) : undefined;
}
