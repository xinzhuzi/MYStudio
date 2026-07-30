export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$", new Set<object>()));
}

export async function sha256CanonicalJson(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 Web Crypto is unavailable");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalize(value: unknown, path: string, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`);
    return value;
  }
  if (value === undefined) throw new TypeError(`${path} cannot contain undefined`);
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain JSON values only`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cyclic reference`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item, index) => normalize(item, `${path}[${index}]`, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} cannot contain symbol keys`);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = normalize(value[key], `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
  return sorted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
