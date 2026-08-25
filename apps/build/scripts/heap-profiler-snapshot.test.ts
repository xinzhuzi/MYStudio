import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type MockSocket = {
  on: (event: "message", listener: (data: { toString: () => string }) => void) => void;
  send: (data: string) => void;
};

type MockWebSocketServer = {
  on: (event: "connection", listener: (socket: MockSocket) => void) => void;
  close: (callback: () => void) => void;
};

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws") as {
  WebSocketServer: new (options: { server: Server }) => MockWebSocketServer;
};
const appsRoot = resolve(__dirname, "../..");
const tempRoots: string[] = [];

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function runSnapshotScript(args: string[]) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = spawn("node", ["build/scripts/heap-profiler-snapshot.cjs", ...args], {
      cwd: appsRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("heap-profiler-snapshot", () => {
  it("assembles CDP snapshot chunks and writes auditable metadata", async () => {
    const outputDir = await mkdtemp(resolve(tmpdir(), "mystudio-heap-profiler-"));
    tempRoots.push(outputDir);
    const commands: string[] = [];
    const snapshotJson = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ["type", "name", "id", "self_size", "edge_count"],
          node_types: [["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic"], "string", "number", "number", "number"],
          edge_fields: ["type", "name_or_index", "to_node"],
          edge_types: [["context", "element", "property", "internal", "hidden", "shortcut", "weak"], "string_or_number", "node"],
        },
        node_count: 3,
        edge_count: 2,
      },
      nodes: [
        9, 0, 1, 0, 1,
        3, 1, 2, 100, 1,
        2, 4, 3, 64, 0,
      ],
      edges: [
        2, 2, 5,
        2, 3, 10,
      ],
      strings: ["(root)", "ImageWorkflowGraph", "imageWorkflows", "imageUrl", "data:image/png;base64,DO_NOT_LOG_PAYLOAD"],
    });
    let debuggerUrl = "";
    const server = createServer((request, response) => {
      if (request.url !== "/json/list") {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{
        type: "page",
        title: "MYStudio test page",
        url: "app://mystudio/studio",
        webSocketDebuggerUrl: debuggerUrl,
      }]));
    });
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { id: number; method: string };
        commands.push(message.method);
        if (message.method === "HeapProfiler.takeHeapSnapshot") {
          const midpoint = Math.floor(snapshotJson.length / 2);
          socket.send(JSON.stringify({
            method: "HeapProfiler.addHeapSnapshotChunk",
            params: { chunk: snapshotJson.slice(0, midpoint) },
          }));
          socket.send(JSON.stringify({
            method: "HeapProfiler.addHeapSnapshotChunk",
            params: { chunk: snapshotJson.slice(midpoint) },
          }));
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;
    debuggerUrl = `ws://127.0.0.1:${port}`;

    try {
      const result = await runSnapshotScript([
        "--port", String(port),
        "--label", "post-gc",
        "--gc",
        "--output-dir", outputDir,
      ]);
      expect(result).toMatchObject({ code: 0, stderr: "" });
      const metadata = JSON.parse(result.stdout.trim()) as {
        label: string;
        gcRequested: boolean;
        outputPath: string;
        metadataPath: string;
        bytes: number;
        chunkCount: number;
        pageUrl: string;
        summary: {
          nodeCount: number;
          edgeCount: number;
          topGroups: Array<{ type: string; name: string; selfSizeBytes: number }>;
          largestNodes: Array<{
            type: string;
            name: string;
            retainerPath: Array<{ via: string | null; name: string }>;
          }>;
        };
      };
      expect(commands).toEqual([
        "HeapProfiler.enable",
        "Runtime.collectGarbage",
        "HeapProfiler.takeHeapSnapshot",
      ]);
      expect(readFileSync(metadata.outputPath, "utf8")).toBe(snapshotJson);
      expect(metadata).toMatchObject({
        label: "post-gc",
        gcRequested: true,
        chunkCount: 2,
        pageUrl: "app://mystudio/studio",
      });
      expect(metadata.bytes).toBeGreaterThan(0);
      expect(metadata.summary).toMatchObject({ nodeCount: 3, edgeCount: 2 });
      expect(metadata.summary.topGroups).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "object", name: "ImageWorkflowGraph", selfSizeBytes: 100 }),
        expect.objectContaining({ type: "string", name: "<string>", selfSizeBytes: 64 }),
      ]));
      expect(metadata.summary.largestNodes[0]?.retainerPath.map((entry) => entry.via)).toEqual([
        null,
        "property:imageWorkflows",
      ]);
      expect(metadata.summary.largestNodes[1]?.retainerPath.map((entry) => entry.via)).toEqual([
        null,
        "property:imageWorkflows",
        "property:imageUrl",
      ]);
      expect(result.stdout).not.toContain("DO_NOT_LOG_PAYLOAD");
      expect(JSON.parse(readFileSync(metadata.metadataPath, "utf8"))).toEqual(metadata);
    } finally {
      await new Promise<void>((resolveClose) => webSocketServer.close(resolveClose));
      await closeServer(server);
    }
  });

  it("fails clearly when the debugging endpoint has no page target", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end("[]");
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runSnapshotScript(["--port", String(port), "--label", "clean"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`no CDP page found at 127.0.0.1:${port}`);
      expect(result.stderr).not.toContain("snapshot\"");
    } finally {
      await closeServer(server);
    }
  });
});
