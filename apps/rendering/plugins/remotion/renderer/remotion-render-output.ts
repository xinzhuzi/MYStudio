import fs from "node:fs";
import path from "node:path";

export async function quarantineRemotionPartialOutput(
  filePath: unknown,
): Promise<string | undefined> {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return undefined;
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return "Remotion 失败输出不是普通文件，未执行隔离";
    const extension = path.extname(filePath) || ".mp4";
    const basename = path.basename(filePath, path.extname(filePath));
    const partialPath = path.join(path.dirname(filePath), `${basename}.partial${extension}`);
    await fs.promises.rename(filePath, partialPath);
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return `Remotion 失败输出隔离失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}
