import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RemotionStudioService } from "@rendering/plugins/remotion/studio/remotion-studio-service";
import { buildMinimalRemotionStudioStartOptions } from "@rendering/plugins/remotion/studio/remotion-studio-start-options";

const appsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const entryPoint = path.join(
  appsRoot,
  "frontend",
  "electron",
  "rendering",
  "plugins",
  "remotion",
  "composition",
  "entry.tsx",
);

interface ProbeReport {
  ok: true;
  generatedAt: string;
  upstreamPort: number;
  proxyPort: number;
  localStatus: number;
  rejectedStatus: number;
  sseStatus: number;
  lanRejected: boolean | "no-lan-address";
  released: boolean;
}

export async function runStudioProbe(): Promise<ProbeReport> {
  const service = new RemotionStudioService();
  const session = await withTimeout(
    service.ensureSession(
      { projectId: "probe-project", chapterId: "probe-chapter", revision: 1 },
      buildMinimalRemotionStudioStartOptions({ appsRoot, entryPoint }),
    ),
    45_000,
    "启动 Remotion Studio probe",
  );
  const local = await request(new URL(session.url));
  const rejected = await request(new URL(`http://127.0.0.1:${session.proxyPort}/?mystudioStudioToken=wrong`));
  const cookie = String(local.headers["set-cookie"] ?? "").split(";", 1)[0] ?? "";
  const sse = await request(new URL(`http://127.0.0.1:${session.proxyPort}/events`), {
    cookie,
    stopAfterFirstChunk: true,
  });
  const lanRejected = await probeLanRejected(session.proxyPort);
  await service.close();
  const released = await portIsReleased(session.proxyPort);
  if (local.status !== 200 || rejected.status !== 401 || sse.status !== 200 || !released) {
    throw new Error(
      `Remotion Studio probe failed: local=${local.status} rejected=${rejected.status} sse=${sse.status} released=${released}`,
    );
  }
  const report: ProbeReport = {
    ok: true,
    generatedAt: new Date().toISOString(),
    upstreamPort: session.upstreamPort,
    proxyPort: session.proxyPort,
    localStatus: local.status,
    rejectedStatus: rejected.status,
    sseStatus: sse.status,
    lanRejected,
    released,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function request(
  url: URL,
  options: { cookie?: string; stopAfterFirstChunk?: boolean } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: options.cookie ? { Cookie: options.cookie } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        };
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          if (options.stopAfterFirstChunk) {
            finish();
            req.destroy();
          }
        });
        res.on("end", finish);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function probeLanRejected(port: number): Promise<boolean | "no-lan-address"> {
  const lanAddress = firstLanAddress();
  if (!lanAddress) return "no-lan-address";
  try {
    await request(new URL(`http://${lanAddress}:${port}/`));
    return false;
  } catch {
    return true;
  }
}

function firstLanAddress(): string | null {
  for (const configs of Object.values(os.networkInterfaces())) {
    for (const config of configs ?? []) {
      if (config.family === "IPv4" && !config.internal) return config.address;
    }
  }
  return null;
}

async function portIsReleased(port: number): Promise<boolean> {
  try {
    await request(new URL(`http://127.0.0.1:${port}/`));
    return false;
  } catch {
    return true;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

if (process.env.MYSTUDIO_REMOTION_STUDIO_PROBE === "1") {
  runStudioProbe().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}

