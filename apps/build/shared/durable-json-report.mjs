import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, resolve } from "node:path";

function reportTimestamp(payload) {
  try {
    const parsed = JSON.parse(payload.toString("utf8"));
    const value = String(parsed.generatedAt || "").replace(/[^0-9A-Za-z]+/g, "");
    if (value) return value;
  } catch {
    // Malformed prior reports are still archived by content hash.
  }
  return "unknown-time";
}

export function archiveExistingJsonReport(filePath) {
  if (!existsSync(filePath)) return null;
  const payload = readFileSync(filePath);
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const extension = extname(filePath);
  const stem = basename(filePath, extension);
  const archivePath = resolve(
    dirname(filePath),
    "report-history",
    stem,
    `${reportTimestamp(payload)}-${sha256.slice(0, 16)}${extension || ".json"}`,
  );
  mkdirSync(dirname(archivePath), { recursive: true });
  if (existsSync(archivePath)) {
    if (!readFileSync(archivePath).equals(payload)) {
      throw new Error(`报告归档路径内容冲突: ${archivePath}`);
    }
  } else {
    writeFileSync(archivePath, payload, { flag: "wx" });
  }
  return archivePath;
}

export function writeDurableJsonReport(filePath, report) {
  const archivePath = archiveExistingJsonReport(filePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { filePath, archivePath };
}
