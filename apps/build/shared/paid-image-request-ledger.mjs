import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const BLOCKING_STATUSES = new Set(["POST_SENT", "TASK_ACCEPTED", "AMBIGUOUS", "COMPLETED"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashReferenceImage(source) {
  const value = String(source || "");
  const match = /^data:image\/[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value);
  if (match) return sha256(Buffer.from(match[1].replace(/\s+/g, ""), "base64"));
  return sha256(value);
}

function readLedger(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`paid image request ledger line ${index + 1} is invalid JSON`);
      }
    });
}

export function latestLedgerEvents(path) {
  const latest = new Map();
  for (const event of readLedger(path)) {
    if (!event || !event.attemptId) continue;
    latest.set(String(event.attemptId), event);
  }
  return [...latest.values()];
}

export function assertRequestNotAlreadyPaid(path, requestFingerprint) {
  if (!path || !requestFingerprint) return;
  const match = latestLedgerEvents(path).find(
    (event) => event.requestFingerprint === requestFingerprint && BLOCKING_STATUSES.has(event.status),
  );
  if (match) {
    throw new Error(
      `paid image request blocked: fingerprint already has ${match.status} evidence `
      + `(attemptId=${String(match.attemptId)})`,
    );
  }
}

export function appendLedgerEvent(path, event) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

export { BLOCKING_STATUSES };
