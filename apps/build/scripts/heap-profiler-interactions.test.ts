import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type MockSocket = {
  on: (event: "message", listener: (data: { toString: () => string }) => void) => void;
  close: () => void;
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
const { buildInteractionExpression } = require("./heap-profiler-interactions.cjs") as {
  buildInteractionExpression: (round: number) => string;
};
const appsRoot = resolve(__dirname, "../..");
const tempRoots: string[] = [];

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function runInteractionScript(args: string[]) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = spawn("node", ["build/scripts/heap-profiler-interactions.cjs", ...args], {
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

describe("heap-profiler-interactions", () => {
  it("uses native committed workflow switching and public zoom state", () => {
    const expression = buildInteractionExpression(0);

    expect(expression).toContain("data-workflow-active-stage");
    expect(expression).toContain("select[data-image-workflow-selector]");
    expect(expression).toContain("data-image-workflow-active-id");
    expect(expression).toContain("new Event('change', { bubbles: true })");
    expect(expression).toContain("selector?.value === workflowTargetId");
    expect(expression).toContain("selector.getAttribute('data-image-workflow-active-id') === workflowTargetId");
    expect(expression).toContain("clickStage('storyboard', '分镜视频生成')");
    expect(expression).toContain("clickStage('imageWorkflow', '图像节点图')");
    expect(expression).toContain("stageSwitchCycleComplete");
    expect(expression).toContain("[data-project-card=\"");
    expect(expression).toContain("normalize(button) === '返回' && isVisible(button)");
    expect(expression).toContain("diagnostics.workflowOptionCount > 1");
    expect(expression).toContain("documentVisibilityState: document.visibilityState");
    expect(expression).toContain("documentHasFocus: document.hasFocus()");
    expect(expression).toContain(".workflow-node-viewport-controls");
    expect(expression).toContain("style.visibility !== 'hidden'");
    expect(expression).toContain("React Flow measures custom nodes asynchronously");
    expect(expression).toContain("document.elementFromPoint");
    expect(expression).not.toContain("data-heap-interaction-drag-target");
    expect(expression).not.toContain("mystudioWorkflowSmoke.setWorkflowStage");
    expect(expression).not.toContain("data-scoped-image-workflow-summary");

    const committedSwitch = expression.slice(
      expression.indexOf("const committedSelector = await waitFor"),
      expression.indexOf("await waitForVisibleCanvas()"),
    );
    expect(committedSwitch).not.toContain("[data-image-workflow-node-kind]");
    expect(expression).toContain("stage,");
    expect(expression).toContain("stageSwitchCycleComplete && canvasBeforeSwitch.ready && canvasAfterSwitch.ready");
    expect(expression).toContain("hasVisibleNode: Boolean(visibleNode)");
    expect(expression).toContain("hasViewportControls: Boolean(controlsElement)");
    expect(expression).toContain("hasImageWorkflowNode: Boolean(imageNode)");
    expect(expression).toContain("hasWorkflowSelector: Boolean(workflowSelector)");
    expect(expression).toContain("a CDP interaction round cannot consume its own command timeout");
    expect(expression.indexOf("const scopedBackButton")).toBeLessThan(
      expression.indexOf("const canvasBeforeSwitch"),
    );
    expect(expression.indexOf("const scopedBackButton")).toBeLessThan(
      expression.indexOf("clickStage('storyboard', '分镜视频生成')"),
    );
  });

  it("records real-project, non-paid interaction evidence with heap samples", async () => {
    const outputDir = await mkdtemp(resolve(tmpdir(), "mystudio-heap-interactions-"));
    tempRoots.push(outputDir);
    const outputPath = resolve(outputDir, "interaction-evidence.json");
    const commands: string[] = [];
    const expressions: string[] = [];
    let interactionAttempt = 0;
    let interactionRound = 0;
    let viewportEvaluation = 0;
    let debuggerUrl = "";
    const server = createServer((request, response) => {
      if (request.url !== "/json/list") {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{
        type: "page",
        title: "道劫 · 漫影工作室",
        url: "app://mystudio/project/chapter-001",
        webSocketDebuggerUrl: debuggerUrl,
      }]));
    });
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params?: { expression?: string };
        };
        commands.push(message.method);
        if (message.method === "Runtime.evaluate") {
          const expression = message.params?.expression || "";
          expressions.push(expression);
          if (expression.includes("forbiddenPersistentMediaCount")) {
            socket.send(JSON.stringify({
              id: message.id,
              result: {
                result: {
                  value: {
                    ok: true,
                    projectId: "49dce4c1-64b1-42de-85c2-9f266698aec4",
                    projectName: "道劫",
                    chapterId: "chapter-001",
                    chapterTitle: "第1章：剑主夜访道口镇",
                    manifestShardCount: 19,
                    imageWorkflowCount: 19,
                    forbiddenPersistentMediaCount: 0,
                  },
                },
              },
            }));
            return;
          }
          if (expression.includes("const controls = document.querySelector('.workflow-node-viewport-controls')")) {
            viewportEvaluation += 1;
            const zoomedIn = viewportEvaluation % 2 === 1;
            socket.send(JSON.stringify({
              id: message.id,
              result: {
                result: {
                  value: zoomedIn
                    ? { percent: 110, transform: "matrix(1.1, 0, 0, 1.1, 0, 0)" }
                    : { percent: 100, transform: "matrix(1, 0, 0, 1, 0, 0)" },
                },
              },
            }));
            return;
          }
          interactionAttempt += 1;
          const ready = interactionAttempt > 1;
          if (ready) interactionRound += 1;
          socket.send(JSON.stringify({
            id: message.id,
            result: {
              result: {
                value: {
                  counters: ready ? {
                    projectEntries: 1,
                    routeEntries: 1,
                    stageSwitches: 2,
                    workflowSwitches: 1,
                    workflowCreates: 1,
                    generatedNodeCreates: 1,
                    zoomActions: 0,
                    dragActions: 1,
                    resizeActions: 1,
                  } : {
                    projectEntries: 0,
                    routeEntries: 0,
                    stageSwitches: 0,
                    workflowSwitches: 0,
                    workflowCreates: 0,
                    generatedNodeCreates: 0,
                    zoomActions: 0,
                    dragActions: 0,
                    resizeActions: 0,
                  },
                  stage: "storyboard",
                  ready,
                  hasWorkflowRoute: true,
                  imageWorkflowNodeCount: 9,
                  reactFlowCount: 1,
                  zoomTargets: {
                    beforeState: { percent: 100, transform: "matrix(1, 0, 0, 1, 0, 0)" },
                    zoomIn: { x: 10, y: 10 },
                    zoomOut: { x: 20, y: 10 },
                  },
                  dragTarget: null,
                },
              },
            },
          }));
          return;
        }
        if (message.method === "Runtime.getHeapUsage") {
          socket.send(JSON.stringify({
            id: message.id,
            result: {
              usedSize: interactionRound * 1024,
              totalSize: interactionRound * 2048,
            },
          }));
          return;
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;
    debuggerUrl = `ws://127.0.0.1:${port}`;

    try {
      const result = await runInteractionScript([
        "--port", String(port),
        "--duration-ms", "1000",
        "--interval-ms", "250",
        "--output", outputPath,
      ]);
      expect(result).toMatchObject({ code: 0, stderr: "" });
      const summary = JSON.parse(result.stdout.trim().split("\n").at(-1) || "{}") as {
        source: string;
        paidGenerationInvoked: boolean;
        requestedDurationMs: number;
        intervalMs: number;
        rounds: number;
        totals: Record<string, number>;
        heap: { firstBytes: number; lastBytes: number; minBytes: number; maxBytes: number };
        outputPath: string;
      };
      const evidence = JSON.parse(readFileSync(outputPath, "utf8")) as typeof summary & {
        samples: Array<{ usedJSHeapSize: number; imageWorkflowNodeCount: number; reactFlowCount: number }>;
      };

      expect(commands[0]).toBe("Runtime.enable");
      expect(commands.filter((command) => command === "Runtime.evaluate").length).toBeGreaterThanOrEqual(4);
      expect(commands.filter((command) => command === "Runtime.getHeapUsage")).toHaveLength(summary.rounds);
      expect(expressions).not.toEqual([]);
      expect(expressions.every((expression) => !expression.includes("fetch(") && !expression.includes("运行生成"))).toBe(true);
      const interactionExpressions = expressions.filter((expression) => expression.includes("const counters = {"));
      expect(interactionExpressions[0]).toContain("if (0 % 12 === 0)");
      expect(interactionExpressions[1]).toContain("if (1 % 12 === 0)");
      expect(summary).toMatchObject({
        source: "real-project-clone",
        paidGenerationInvoked: false,
        requestedDurationMs: 1000,
        intervalMs: 250,
        outputPath,
      });
      expect(summary.rounds).toBeGreaterThanOrEqual(3);
      expect(summary.totals).toMatchObject({
        projectEntries: summary.rounds,
        stageSwitches: summary.rounds * 2,
        workflowCreates: summary.rounds,
        generatedNodeCreates: summary.rounds,
        zoomActions: summary.rounds * 2,
        dragActions: summary.rounds,
      });
      expect(summary.heap).toMatchObject({ firstBytes: 1024, lastBytes: summary.rounds * 1024, minBytes: 1024, maxBytes: summary.rounds * 1024 });
      expect(evidence).toMatchObject({
        source: summary.source,
        paidGenerationInvoked: summary.paidGenerationInvoked,
        requestedDurationMs: summary.requestedDurationMs,
        intervalMs: summary.intervalMs,
        rounds: summary.rounds,
        totals: summary.totals,
        heap: summary.heap,
      });
      expect(evidence.samples).toHaveLength(summary.rounds);
      expect(evidence.samples).toEqual(expect.arrayContaining([
        expect.objectContaining({ usedJSHeapSize: 1024, imageWorkflowNodeCount: 9, reactFlowCount: 1 }),
      ]));
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      await new Promise<void>((resolveClose) => webSocketServer.close(resolveClose));
      await closeServer(server);
    }
  });

  it("reconnects and revalidates the clone after the inspected page navigates", async () => {
    const outputDir = await mkdtemp(resolve(tmpdir(), "mystudio-heap-interactions-reconnect-"));
    tempRoots.push(outputDir);
    const outputPath = resolve(outputDir, "interaction-evidence.json");
    let debuggerUrl = "";
    let connectionCount = 0;
    let heapRound = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/json/list" ? [{
        type: "page",
        title: "道劫 · 漫影工作室",
        url: "app://mystudio/project/chapter-001",
        webSocketDebuggerUrl: debuggerUrl,
      }] : []));
    });
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      connectionCount += 1;
      const currentConnection = connectionCount;
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params?: { expression?: string };
        };
        if (message.method === "Runtime.evaluate") {
          const identity = message.params?.expression?.includes("forbiddenPersistentMediaCount");
          if (identity) {
            socket.send(JSON.stringify({
              id: message.id,
              result: {
                result: {
                  value: {
                    ok: true,
                    projectId: "49dce4c1-64b1-42de-85c2-9f266698aec4",
                    projectName: "道劫",
                    chapterId: "chapter-001",
                    forbiddenPersistentMediaCount: 0,
                  },
                },
              },
            }));
            return;
          }
          if (currentConnection === 1) {
            socket.send(JSON.stringify({
              id: message.id,
              error: { message: "Inspected target navigated or closed" },
            }));
            return;
          }
          socket.send(JSON.stringify({
            id: message.id,
            result: {
              result: {
                value: {
                  counters: {
                    projectEntries: 1,
                    routeEntries: 1,
                    stageSwitches: 2,
                    workflowSwitches: 1,
                    workflowCreates: 1,
                    generatedNodeCreates: 1,
                    zoomActions: 2,
                    dragActions: 1,
                    resizeActions: 1,
                  },
                  stage: "imageWorkflow",
                  ready: true,
                  hasWorkflowRoute: true,
                  imageWorkflowNodeCount: 2,
                  reactFlowCount: 1,
                  zoomTargets: null,
                  dragTarget: null,
                },
              },
            },
          }));
          return;
        }
        if (message.method === "Runtime.getHeapUsage") {
          heapRound += 1;
          socket.send(JSON.stringify({
            id: message.id,
            result: { usedSize: heapRound * 1024, totalSize: heapRound * 2048 },
          }));
          return;
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;
    debuggerUrl = `ws://127.0.0.1:${port}`;

    try {
      const result = await runInteractionScript([
        "--port", String(port),
        "--duration-ms", "1000",
        "--interval-ms", "250",
        "--output", outputPath,
      ]);
      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(connectionCount).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        status: "passed",
        targetReconnects: 1,
        paidGenerationInvoked: false,
      });
    } finally {
      await new Promise<void>((resolveClose) => webSocketServer.close(resolveClose));
      await closeServer(server);
    }
  });

  it("reconnects after the websocket closes during heap sampling", async () => {
    const outputDir = await mkdtemp(resolve(tmpdir(), "mystudio-heap-interactions-socket-close-"));
    tempRoots.push(outputDir);
    const outputPath = resolve(outputDir, "interaction-evidence.json");
    let debuggerUrl = "";
    let connectionCount = 0;
    let heapRound = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/json/list" ? [{
        type: "page",
        title: "道劫 · 漫影工作室",
        url: "app://mystudio/project/chapter-001",
        webSocketDebuggerUrl: debuggerUrl,
      }] : []));
    });
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      connectionCount += 1;
      const currentConnection = connectionCount;
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params?: { expression?: string };
        };
        if (message.method === "Runtime.evaluate") {
          const identity = message.params?.expression?.includes("forbiddenPersistentMediaCount");
          socket.send(JSON.stringify({
            id: message.id,
            result: {
              result: {
                value: identity
                  ? {
                      ok: true,
                      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec4",
                      projectName: "道劫",
                      chapterId: "chapter-001",
                      forbiddenPersistentMediaCount: 0,
                    }
                  : {
                      counters: {
                        stageSwitches: 2,
                        workflowSwitches: 1,
                        workflowCreates: 1,
                        generatedNodeCreates: 1,
                        zoomActions: 2,
                        dragActions: 1,
                      },
                      stage: "imageWorkflow",
                      ready: true,
                      hasWorkflowRoute: true,
                      imageWorkflowNodeCount: 2,
                      reactFlowCount: 1,
                      zoomTargets: null,
                      dragTarget: null,
                    },
              },
            },
          }));
          return;
        }
        if (message.method === "Runtime.getHeapUsage") {
          if (currentConnection === 1) {
            socket.close();
            return;
          }
          heapRound += 1;
          socket.send(JSON.stringify({
            id: message.id,
            result: { usedSize: heapRound * 1024, totalSize: heapRound * 2048 },
          }));
          return;
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;
    debuggerUrl = `ws://127.0.0.1:${port}`;

    try {
      const result = await runInteractionScript([
        "--port", String(port),
        "--duration-ms", "1000",
        "--interval-ms", "250",
        "--output", outputPath,
      ]);
      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(connectionCount).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        status: "passed",
        targetReconnects: 1,
        paidGenerationInvoked: false,
      });
    } finally {
      await new Promise<void>((resolveClose) => webSocketServer.close(resolveClose));
      await closeServer(server);
    }
  });

  it("fails closed and writes durable evidence when a native action is missing", async () => {
    const outputDir = await mkdtemp(resolve(tmpdir(), "mystudio-heap-interactions-failed-"));
    tempRoots.push(outputDir);
    const outputPath = resolve(outputDir, "interaction-evidence.json");
    let debuggerUrl = "";
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/json/list" ? [{
        type: "page",
        title: "道劫 · 漫影工作室",
        url: "app://mystudio/project/chapter-001",
        webSocketDebuggerUrl: debuggerUrl,
      }] : []));
    });
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params?: { expression?: string };
        };
        if (message.method === "Runtime.evaluate") {
          const identity = message.params?.expression?.includes("forbiddenPersistentMediaCount");
          socket.send(JSON.stringify({
            id: message.id,
            result: {
              result: {
                value: identity
                  ? {
                      ok: true,
                      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec4",
                      projectName: "道劫",
                      chapterId: "chapter-001",
                      forbiddenPersistentMediaCount: 0,
                    }
                  : {
                      counters: {
                        stageSwitches: 2,
                        workflowSwitches: 0,
                        workflowCreates: 1,
                        generatedNodeCreates: 1,
                        zoomActions: 2,
                        dragActions: 1,
                      },
                      stage: "storyboard",
                      ready: true,
                      hasWorkflowRoute: true,
                      imageWorkflowNodeCount: 2,
                      reactFlowCount: 1,
                      zoomTargets: null,
                      dragTarget: null,
                    },
              },
            },
          }));
          return;
        }
        if (message.method === "Runtime.getHeapUsage") {
          socket.send(JSON.stringify({ id: message.id, result: { usedSize: 1024, totalSize: 2048 } }));
          return;
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;
    debuggerUrl = `ws://127.0.0.1:${port}`;

    try {
      const result = await runInteractionScript([
        "--port", String(port),
        "--duration-ms", "1000",
        "--interval-ms", "250",
        "--output", outputPath,
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("interaction run missed required actions: workflowSwitches");
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        status: "failed",
        source: "real-project-clone",
        paidGenerationInvoked: false,
        missingActions: ["workflowSwitches"],
      });
    } finally {
      await new Promise<void>((resolveClose) => webSocketServer.close(resolveClose));
      await closeServer(server);
    }
  });

  it("records the exact canvas readiness blocker when every interaction attempt stays unready", async () => {
    const outputDir = await mkdtemp(resolve(tmpdir(), "mystudio-heap-interactions-unready-"));
    tempRoots.push(outputDir);
    const outputPath = resolve(outputDir, "interaction-evidence.json");
    let debuggerUrl = "";
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/json/list" ? [{
        type: "page",
        title: "道劫 · 漫影工作室",
        url: "app://mystudio/project/chapter-001",
        webSocketDebuggerUrl: debuggerUrl,
      }] : []));
    });
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params?: { expression?: string };
        };
        if (message.method === "Runtime.evaluate") {
          const identity = message.params?.expression?.includes("forbiddenPersistentMediaCount");
          socket.send(JSON.stringify({
            id: message.id,
            result: {
              result: {
                value: identity
                  ? {
                      ok: true,
                      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec4",
                      projectName: "道劫",
                      chapterId: "chapter-001",
                      forbiddenPersistentMediaCount: 0,
                    }
                  : {
                      counters: { resizeActions: 1 },
                      stage: "imageWorkflow",
                      ready: false,
                      readiness: {
                        beforeSwitch: {
                          hasVisibleNode: false,
                          hasViewportControls: true,
                          hasImageWorkflowNode: true,
                          hasWorkflowSelector: true,
                        },
                        afterSwitch: {
                          hasVisibleNode: false,
                          hasViewportControls: true,
                          hasImageWorkflowNode: true,
                          hasWorkflowSelector: true,
                        },
                      },
                      hasWorkflowRoute: true,
                      imageWorkflowNodeCount: 1,
                      reactFlowCount: 1,
                    },
              },
            },
          }));
          return;
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;
    debuggerUrl = `ws://127.0.0.1:${port}`;

    try {
      const result = await runInteractionScript([
        "--port", String(port),
        "--duration-ms", "1000",
        "--interval-ms", "250",
        "--output", outputPath,
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("interaction run has invalid or missing CDP heap samples");
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        status: "failed",
        source: "real-project-clone",
        attempts: expect.any(Number),
        unreadyAttempts: expect.any(Number),
        lastReadiness: {
          beforeSwitch: { hasVisibleNode: false },
          afterSwitch: { hasVisibleNode: false },
        },
      });
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
      const result = await runInteractionScript(["--port", String(port), "--duration-ms", "1000"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`no CDP page found at 127.0.0.1:${port}`);
      expect(result.stderr).not.toContain("interaction-evidence");
    } finally {
      await closeServer(server);
    }
  });

  it("fails clearly when the debugging endpoint does not respond", async () => {
    const server = createServer(() => {
      // Keep the request open to exercise the explicit HTTP timeout path.
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolveListening) => server.once("listening", resolveListening));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runInteractionScript([
        "--port", String(port),
        "--duration-ms", "1000",
        "--command-timeout-ms", "1000",
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("CDP endpoint timed out after 1000ms");
    } finally {
      await closeServer(server);
    }
  });
});
