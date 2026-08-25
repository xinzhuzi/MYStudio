#!/usr/bin/env node
// Capture a Chromium renderer heap using CDP HeapProfiler, without relying on
// performance.memory (which is only a coarse counter and cannot show retainers).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("../../node_modules/ws");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9222;
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "output", "automation", "heap-profiler");
const LABELS = new Set(["clean", "interaction", "post-gc"]);

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    label: "interaction",
    outputDir: DEFAULT_OUTPUT_DIR,
    gc: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--gc") {
      options.gc = true;
    } else if (arg === "--host" || arg === "--port" || arg === "--label" || arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--host") options.host = value;
      if (arg === "--port") options.port = Number(value);
      if (arg === "--label") options.label = value;
      if (arg === "--output-dir") options.outputDir = path.resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`invalid port: ${options.port}`);
  }
  if (!LABELS.has(options.label)) {
    throw new Error(`label must be one of: ${[...LABELS].join(", ")}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node apps/build/scripts/heap-profiler-snapshot.cjs [options]",
    "  --label clean|interaction|post-gc   snapshot state label (default: interaction)",
    "  --output-dir <path>                 output directory",
    "  --host <host> --port <port>         CDP endpoint (default: 127.0.0.1:9222)",
    "  --gc                                request Runtime.collectGarbage first",
  ].join("\n");
}

function getJson(host, port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host, port, path: requestPath }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`CDP endpoint returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("CDP endpoint returned invalid JSON"));
        }
      });
    });
    request.on("error", (error) => reject(new Error(`CDP endpoint unavailable: ${error.message}`)));
  });
}

function connectCdp(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl, { maxPayload: 1024 * 1024 * 1024 });
    const pending = new Map();
    let sequence = 0;
    const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
      const id = ++sequence;
      pending.set(id, { resolve: resolveSend, reject: rejectSend });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || "CDP command failed"));
        else request.resolve(message.result);
      }
    });
    socket.once("open", () => resolve({ socket, send }));
    socket.once("error", (error) => reject(new Error(`CDP websocket unavailable: ${error.message}`)));
  });
}

function safeLabel(label) {
  return label.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

function snapshotFieldIndex(fields, field, owner) {
  const index = Array.isArray(fields) ? fields.indexOf(field) : -1;
  if (index < 0) throw new Error(`heap snapshot ${owner} is missing field: ${field}`);
  return index;
}

function safeSnapshotName(type, value) {
  if (type.includes("string")) return "<string>";
  if (typeof value !== "string" || !value) return "<unnamed>";
  if (/^(?:data|blob):/i.test(value)) return "<redacted-url>";
  return value.length > 96 ? "<redacted-long-name>" : value;
}

function keepLargest(items, item, limit) {
  items.push(item);
  items.sort((left, right) => right.selfSizeBytes - left.selfSizeBytes);
  if (items.length > limit) items.pop();
}

function summarizeHeapSnapshot(snapshot, limit = 10) {
  const meta = snapshot?.snapshot?.meta;
  const nodes = snapshot?.nodes;
  const edges = snapshot?.edges;
  const strings = snapshot?.strings;
  if (!meta || !Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(strings)) {
    throw new Error("heap snapshot payload is incomplete");
  }

  const nodeFields = meta.node_fields;
  const edgeFields = meta.edge_fields;
  const nodeFieldCount = nodeFields.length;
  const edgeFieldCount = edgeFields.length;
  const nodeTypeOffset = snapshotFieldIndex(nodeFields, "type", "node_fields");
  const nodeNameOffset = snapshotFieldIndex(nodeFields, "name", "node_fields");
  const nodeSelfSizeOffset = snapshotFieldIndex(nodeFields, "self_size", "node_fields");
  const nodeEdgeCountOffset = snapshotFieldIndex(nodeFields, "edge_count", "node_fields");
  const edgeTypeOffset = snapshotFieldIndex(edgeFields, "type", "edge_fields");
  const edgeNameOffset = snapshotFieldIndex(edgeFields, "name_or_index", "edge_fields");
  const edgeTargetOffset = snapshotFieldIndex(edgeFields, "to_node", "edge_fields");
  const nodeTypes = meta.node_types[nodeTypeOffset];
  const edgeTypes = meta.edge_types[edgeTypeOffset];
  if (!Array.isArray(nodeTypes) || !Array.isArray(edgeTypes)) {
    throw new Error("heap snapshot type tables are incomplete");
  }
  if (nodes.length % nodeFieldCount !== 0 || edges.length % edgeFieldCount !== 0) {
    throw new Error("heap snapshot node or edge table is misaligned");
  }

  const nodeCount = nodes.length / nodeFieldCount;
  const edgeCount = edges.length / edgeFieldCount;
  const edgeStarts = new Int32Array(nodeCount + 1);
  const groups = new Map();
  const largest = [];
  let edgeCursor = 0;
  let totalSelfSizeBytes = 0;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const base = nodeIndex * nodeFieldCount;
    const type = nodeTypes[nodes[base + nodeTypeOffset]] || "unknown";
    const name = safeSnapshotName(type, strings[nodes[base + nodeNameOffset]]);
    const selfSizeBytes = Number(nodes[base + nodeSelfSizeOffset]) || 0;
    const outgoingEdgeCount = Number(nodes[base + nodeEdgeCountOffset]) || 0;
    edgeStarts[nodeIndex] = edgeCursor;
    edgeCursor += outgoingEdgeCount * edgeFieldCount;
    totalSelfSizeBytes += selfSizeBytes;
    const groupKey = `${type}\u0000${name}`;
    const group = groups.get(groupKey) || { type, name, count: 0, selfSizeBytes: 0 };
    group.count += 1;
    group.selfSizeBytes += selfSizeBytes;
    groups.set(groupKey, group);
    if (selfSizeBytes > 0) keepLargest(largest, { nodeIndex, type, name, selfSizeBytes }, limit);
  }
  edgeStarts[nodeCount] = edgeCursor;
  if (edgeCursor !== edges.length) throw new Error("heap snapshot edge counts do not match edge table");

  const parent = new Int32Array(nodeCount);
  const parentEdge = new Int32Array(nodeCount);
  parent.fill(-2);
  parentEdge.fill(-1);
  const queue = new Int32Array(nodeCount);
  let readIndex = 0;
  let writeIndex = 0;
  if (nodeCount > 0) {
    parent[0] = -1;
    queue[writeIndex++] = 0;
  }
  while (readIndex < writeIndex) {
    const source = queue[readIndex++];
    for (let edgeIndex = edgeStarts[source]; edgeIndex < edgeStarts[source + 1]; edgeIndex += edgeFieldCount) {
      const edgeType = edgeTypes[edges[edgeIndex + edgeTypeOffset]] || "unknown";
      if (edgeType === "weak") continue;
      const targetOffset = Number(edges[edgeIndex + edgeTargetOffset]);
      const target = targetOffset / nodeFieldCount;
      if (!Number.isInteger(target) || target < 0 || target >= nodeCount || parent[target] !== -2) continue;
      parent[target] = source;
      parentEdge[target] = edgeIndex;
      queue[writeIndex++] = target;
    }
  }

  const edgeLabel = (edgeIndex) => {
    const type = edgeTypes[edges[edgeIndex + edgeTypeOffset]] || "unknown";
    const rawName = edges[edgeIndex + edgeNameOffset];
    const value = type === "element" || type === "hidden"
      ? String(rawName)
      : strings[rawName];
    const name = typeof value === "string" && value.length <= 96 && !/^(?:data|blob):/i.test(value)
      ? value
      : "<redacted>";
    return `${type}:${name}`;
  };
  const nodeProjection = (nodeIndex, via) => {
    const base = nodeIndex * nodeFieldCount;
    const type = nodeTypes[nodes[base + nodeTypeOffset]] || "unknown";
    return {
      via,
      type,
      name: safeSnapshotName(type, strings[nodes[base + nodeNameOffset]]),
      selfSizeBytes: Number(nodes[base + nodeSelfSizeOffset]) || 0,
    };
  };
  const retainerPath = (target) => {
    const reverse = [];
    let current = target;
    for (let depth = 0; current >= 0 && depth < 32; depth += 1) {
      reverse.push(nodeProjection(current, parentEdge[current] >= 0 ? edgeLabel(parentEdge[current]) : null));
      if (parent[current] === -1) break;
      current = parent[current];
    }
    return reverse.reverse();
  };

  return {
    nodeCount,
    edgeCount,
    totalSelfSizeBytes,
    topGroups: [...groups.values()]
      .sort((left, right) => right.selfSizeBytes - left.selfSizeBytes)
      .slice(0, limit),
    largestNodes: largest.map((node) => ({
      type: node.type,
      name: node.name,
      selfSizeBytes: node.selfSizeBytes,
      retainerPath: retainerPath(node.nodeIndex),
    })),
  };
}

function summarizeHeapSnapshotFile(snapshotPath, limit = 10) {
  return summarizeHeapSnapshot(JSON.parse(fs.readFileSync(snapshotPath, "utf8")), limit);
}

function buildSnapshotMetadata(options, details) {
  return {
    schemaVersion: 1,
    label: options.label,
    gcRequested: options.gc,
    startedAt: details.startedAt,
    finishedAt: details.finishedAt,
    durationMs: details.finishedAt - details.startedAt,
    outputPath: details.outputPath,
    metadataPath: details.metadataPath,
    bytes: details.bytes,
    chunkCount: details.chunkCount,
    pageUrl: details.pageUrl || "",
    pageTitle: details.pageTitle || "",
    summary: details.summary,
  };
}

async function captureSnapshot(options) {
  const targets = await getJson(options.host, options.port, "/json/list");
  const page = Array.isArray(targets) ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) : null;
  if (!page) throw new Error(`no CDP page found at ${options.host}:${options.port}`);

  fs.mkdirSync(options.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basename = `renderer-${safeLabel(options.label)}-${stamp}`;
  const outputPath = path.join(options.outputDir, `${basename}.heapsnapshot`);
  const metadataPath = path.join(options.outputDir, `${basename}.json`);
  const startedAt = Date.now();
  let bytes = 0;
  let chunkCount = 0;
  let outputFd = null;
  let outputClosed = false;
  const { socket, send } = await connectCdp(page.webSocketDebuggerUrl);
  const close = () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };
  const onMessage = (data) => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message.method !== "HeapProfiler.addHeapSnapshotChunk") return;
    const chunk = typeof message.params?.chunk === "string" ? message.params.chunk : "";
    if (!chunk) return;
    chunkCount += 1;
    bytes += Buffer.byteLength(chunk, "utf8");
    fs.writeSync(outputFd, chunk, null, "utf8");
  };
  socket.on("message", onMessage);
  try {
    outputFd = fs.openSync(outputPath, "wx");
    await send("HeapProfiler.enable");
    if (options.gc) await send("Runtime.collectGarbage");
    await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    fs.closeSync(outputFd);
    outputClosed = true;
    const summary = summarizeHeapSnapshotFile(outputPath);
    const finishedAt = Date.now();
    const metadata = buildSnapshotMetadata(options, {
      startedAt,
      finishedAt,
      outputPath,
      metadataPath,
      bytes,
      chunkCount,
      pageUrl: page.url,
      pageTitle: page.title,
      summary,
    });
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return metadata;
  } finally {
    if (outputFd !== null && !outputClosed) fs.closeSync(outputFd);
    socket.off("message", onMessage);
    close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const metadata = await captureSnapshot(options);
  console.log(JSON.stringify(metadata));
}

module.exports = {
  LABELS,
  buildSnapshotMetadata,
  parseArgs,
  safeLabel,
  summarizeHeapSnapshot,
  summarizeHeapSnapshotFile,
  captureSnapshot,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[heap-profiler] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
