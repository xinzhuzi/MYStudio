import { spawnSync } from "node:child_process";

export const MYSTUDIO_APP_NAME = "漫影工作室";

export function sampleFrontmostApplication(reason) {
  const sample = {
    at: new Date().toISOString(),
    reason,
    applicationName: "",
    processId: null,
    bundlePath: "",
  };
  if (process.platform !== "darwin") {
    return { ...sample, error: "frontmost application sampling is macOS-only" };
  }

  const front = spawnSync("/usr/bin/lsappinfo", ["front"], {
    encoding: "utf8",
  });
  const asn = front.status === 0 ? front.stdout.trim() : "";
  if (!asn) {
    return {
      ...sample,
      error: front.stderr.trim() || "lsappinfo front returned no application",
    };
  }

  const info = spawnSync("/usr/bin/lsappinfo", [
    "info",
    "-only",
    "name",
    "pid",
    "bundlepath",
    asn,
  ], {
    encoding: "utf8",
  });
  const nameMatch = info.stdout.match(/"LSDisplayName"="([^"]*)"/);
  const processIdMatch = info.stdout.match(/"pid"=(\d+)/);
  const bundlePathMatch = info.stdout.match(/"LSBundlePath"="([^"]*)"/);
  if (info.status !== 0 || !nameMatch) {
    return {
      ...sample,
      error: info.stderr.trim() || "lsappinfo did not return LSDisplayName",
    };
  }
  return {
    ...sample,
    applicationName: nameMatch[1],
    processId: processIdMatch ? Number(processIdMatch[1]) : null,
    bundlePath: bundlePathMatch?.[1] ?? "",
  };
}

export function hasMYStudioForegroundViolation(samples) {
  return samples.some(
    (sample) => sample.applicationName === MYSTUDIO_APP_NAME,
  );
}
