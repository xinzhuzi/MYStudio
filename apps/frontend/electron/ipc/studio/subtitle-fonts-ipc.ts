// 自定义字幕字体 IPC —— 设置页导入/列表/删除/读取字节。
// 频道用字符串字面量（IPC 契约测试扫描 ipcMain.handle 字面量）。
// 存储逻辑在 lib/studio/remotion/custom-font-store.ts（纯 fs，无 electron 依赖，
// 渲染主机与独立工具共用）。

import { ipcMain, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";

import {
  customFontFamilyForId,
  customSubtitleFontIdForFileName,
  isCustomSubtitleFontId,
} from "@/lib/studio/remotion/subtitle-fonts";
import {
  customFontsDir,
  isAllowedFontFileName,
  listCustomSubtitleFonts,
} from "@/lib/studio/remotion/custom-font-store";

const MAX_FONT_BYTES = 20 * 1024 * 1024;

export function registerSubtitleFontsIpcHandlers(options: { getUserDataPath: () => string }): void {
  const dir = () => customFontsDir(options.getUserDataPath());

  ipcMain.handle("subtitleFonts:list", () => listCustomSubtitleFonts(options.getUserDataPath()));

  ipcMain.handle("subtitleFonts:import", async () => {
    const picked = await dialog.showOpenDialog({
      title: "导入自定义字幕字体",
      message: "选择字体文件（.ttf / .otf / .woff2，≤20MB）",
      properties: ["openFile"],
      filters: [{ name: "字体文件", extensions: ["ttf", "otf", "woff2"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { success: false, code: "canceled" as const };
    const sourcePath = picked.filePaths[0]!;
    const stat = await fs.promises.stat(sourcePath).catch(() => undefined);
    if (!stat?.isFile()) return { success: false, code: "invalid-file" as const, message: "文件不存在" };
    if (stat.size <= 0 || stat.size > MAX_FONT_BYTES) {
      return { success: false, code: "invalid-size" as const, message: "字体文件必须大于 0 且不超过 20MB" };
    }
    const fileName = path.basename(sourcePath);
    if (!isAllowedFontFileName(fileName)) {
      return { success: false, code: "invalid-extension" as const, message: "仅支持 .ttf / .otf / .woff2" };
    }
    fs.mkdirSync(dir(), { recursive: true });
    // 同 id 视为覆盖更新（同名重导=替换文件）。
    await fs.promises.copyFile(sourcePath, path.join(dir(), fileName));
    const id = customSubtitleFontIdForFileName(fileName);
    return { success: true as const, font: { id, label: id.slice("custom:".length), family: customFontFamilyForId(id), fileName, sizeBytes: stat.size } };
  });

  ipcMain.handle("subtitleFonts:delete", (_event, fontId: unknown) => {
    if (typeof fontId !== "string" || !isCustomSubtitleFontId(fontId)) {
      return { success: false as const, code: "invalid-id" as const, message: "非法字体 id" };
    }
    const dirPath = customFontsDir(options.getUserDataPath());
    if (!fs.existsSync(dirPath)) return { success: false as const, code: "not-found" as const, message: "字体不存在" };
    const match = fs.readdirSync(dirPath).find(
      (name) => isAllowedFontFileName(name) && customSubtitleFontIdForFileName(name) === fontId,
    );
    if (!match) return { success: false as const, code: "not-found" as const, message: "字体不存在" };
    fs.rmSync(path.join(dirPath, match));
    return { success: true as const };
  });

  ipcMain.handle("subtitleFonts:read", (_event, fontId: unknown) => {
    if (typeof fontId !== "string" || !isCustomSubtitleFontId(fontId)) {
      return { success: false as const, code: "invalid-id" as const, message: "非法字体 id" };
    }
    const dirPath = customFontsDir(options.getUserDataPath());
    if (!fs.existsSync(dirPath)) return { success: false as const, code: "not-found" as const, message: "字体不存在" };
    const match = fs.readdirSync(dirPath).find(
      (name) => isAllowedFontFileName(name) && customSubtitleFontIdForFileName(name) === fontId,
    );
    if (!match) return { success: false as const, code: "not-found" as const, message: "字体不存在" };
    const data = fs.readFileSync(path.join(dirPath, match));
    return { success: true as const, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
}
