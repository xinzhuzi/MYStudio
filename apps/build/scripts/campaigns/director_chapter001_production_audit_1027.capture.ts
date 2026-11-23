/** Offline only: execute the current hook callback with the actual manager and an inert IPC. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { aiManager, type AITextRequest } from "@/lib/ai/ai-manager";
import { prepareTextCompletionRequest, type TextCompletionRequest } from "@/lib/ai/text-completion";
import { buildDaojieAuditMessages, reviewDaojieGeneration, type DaojieAuditInput, type DaojieGenerationStage } from "@/lib/studio/daojie-generation-audit";
import { auditDirectorPlanStructure, parseDirectorPlan } from "@/lib/studio/director-plan";
import { parseStoryboardTable } from "@/lib/studio/storyboard-table";
import { formatScriptPlanContext } from "@/components/panels/studio/workflow-helpers";

export interface AuditJob {
  stage: DaojieGenerationStage;
  input: { episodeId: string; chapterText: string; bibleContext?: string };
  scriptText: string;
  planRaw: string;
  outputText: string;
}
type Messages = ReturnType<typeof buildDaojieAuditMessages>;
const scriptHook = "frontend/components/panels/studio/useScriptStageActions.ts";
const planningHook = "frontend/components/panels/studio/useProductionPlanningActions.ts";
function source(file: string) {
  return ts.createSourceFile(file, readFileSync(path.resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
}
function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
/** Read exact production constants and callback; ambiguity rejects instead of reconstructing policy. */
export function readHookPolicy(stage: DaojieGenerationStage) {
  const constants: Record<string, number> = {};
  const scriptSource = source(scriptHook);
  const agentKeys: string[] = [];
  walk(scriptSource, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text.endsWith("_STREAM_TIMEOUT_MS") && node.initializer && ts.isNumericLiteral(node.initializer)) {
      constants[node.name.text] = Number(node.initializer.text);
    }
    if (ts.isPropertySignature(node) && node.name.getText(scriptSource) === "agentKey" && node.type && ts.isLiteralTypeNode(node.type) && ts.isStringLiteral(node.type.literal)) agentKeys.push(node.type.literal.text);
  });
  if (agentKeys.length !== 1) throw new Error("script_agent_policy_ambiguous");
  const file = stage === "script" ? scriptHook : planningHook;
  const tree = stage === "script" ? scriptSource : source(file);
  const callbacks: ts.ArrowFunction[] = [];
  walk(tree, (node) => {
    if (!ts.isCallExpression(node) || node.expression.getText(tree) !== "reviewDaojieGeneration") return;
    const [input, callback] = node.arguments;
    if (!input || !ts.isObjectLiteralExpression(input) || !callback || !ts.isArrowFunction(callback)) return;
    const declared = input.properties.find((entry) => ts.isPropertyAssignment(entry) && entry.name.getText(tree) === "stage");
    if (declared && ts.isPropertyAssignment(declared) && ts.isStringLiteral(declared.initializer) && declared.initializer.text === stage) callbacks.push(callback);
  });
  if (callbacks.length !== 1) throw new Error("audit_hook_policy_ambiguous");
  const callback = callbacks[0]!;
  if (!ts.isCallExpression(callback.body) || callback.body.expression.getText(tree) !== "aiManager.textStream") throw new Error("audit_hook_not_manager_stream");
  return { sourceFile: file, line: tree.getLineAndCharacterOfPosition(callback.getStart(tree)).line + 1, callback: callback.getText(tree), constants, scriptAgent: agentKeys[0]! };
}
function auditInput(job: AuditJob): { input: DaojieAuditInput; parsed?: unknown } {
  const input: DaojieAuditInput = { stage: job.stage, sourceText: job.input.chapterText, bibleContext: job.input.bibleContext, outputText: job.outputText };
  if (job.stage !== "script") input.scriptText = job.scriptText;
  if (job.stage === "planning") {
    const parsed = auditDirectorPlanStructure(job.outputText);
    if (!parsed.passed) throw new Error("production_structure_rejected");
    return { input, parsed };
  }
  if (job.stage === "storyboard") {
    const board = parseStoryboardTable(job.outputText, job.input.episodeId, { requireShotSemantics: true });
    if (board.errors.length || !board.rows.length) throw new Error("production_structure_rejected");
    const plan = parseDirectorPlan(job.planRaw, job.input.episodeId);
    if (!plan.plan) throw new Error("production_upstream_plan_rejected");
    input.planText = formatScriptPlanContext(plan.plan);
    input.totalDurationSeconds = board.rows.reduce((sum, row) => sum + row.duration, 0);
    return { input, parsed: board };
  }
  return { input };
}
export async function parseProductionAudit(job: AuditJob, response: { success: boolean; text: string; error?: string }) {
  const { input } = auditInput(job);
  return reviewDaojieGeneration(input, async () => response);
}
export async function captureProductionAudit(job: AuditJob): Promise<Record<string, unknown>> {
  if (!["script", "planning", "storyboard"].includes(job.stage)) throw new Error("invalid_audit_stage");
  const { input, parsed } = auditInput(job);
  const policy = readHookPolicy(job.stage);
  let ipc: TextCompletionRequest | undefined;
  let hookRequest: AITextRequest | undefined;
  // No Electron bridge or real configuration is consulted. The test supplies only a public-default binding fixture.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const forbiddenNetwork = () => { throw new Error("offline_network_forbidden"); };
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
    electronAPI: { textCompletionStream: async (payload: TextCompletionRequest) => {
      if (ipc) throw new Error("multiple_ipc_calls_forbidden");
      ipc = payload;
      return { success: false, error: "offline_ipc_capture_no_model_call" };
    } },
  } });
  globalThis.fetch = forbiddenNetwork;
  try {
    const invoke = runInNewContext(`(${policy.callback})`, {
      aiManager: { textStream: (request: AITextRequest, onChunk: (delta: string, kind: "text" | "thinking") => void) => {
        hookRequest = request;
        return aiManager.textStream(request, onChunk);
      } },
      opts: { agentKey: policy.scriptAgent }, ...policy.constants,
    }, { timeout: 1000 }) as (messages: Messages) => ReturnType<typeof aiManager.textStream>;
    const messages = buildDaojieAuditMessages(input);
    // The production deterministic gate must actually invoke its callback before any prepared request exists.
    const gate = await reviewDaojieGeneration(input, async (actual) => {
      if (JSON.stringify(actual) !== JSON.stringify(messages)) throw new Error("builder_message_drift");
      return invoke(actual);
    });
    if (!ipc || !hookRequest) throw new Error("production_structure_rejected:" + gate.report.split("\n\n")[1]);
    const wire = prepareTextCompletionRequest({ ...ipc, provider: { ...ipc.provider, apiKey: "offline-inert-serialization-placeholder" } });
    if (!wire.success || wire.attempts.length !== 1 || wire.attempts[0]!.protocol !== "anthropic-compatible") throw new Error("production_wire_preparation_failed");
    return {
      request: wire.attempts[0]!.body,
      ipcRequest: ipc,
      ipcUndefinedKeys: Object.entries(ipc).filter(([, value]) => value === undefined).map(([key]) => key),
      hookRequest,
      hookPolicy: policy,
      auditInput: input,
      structurePassed: true,
      totalDurationSeconds: input.totalDurationSeconds,
      parsed,
      wireScope: "Actual textStream IPC captured. request is the production Anthropic HTTP nonstream body from prepareTextCompletionRequest, for the existing root sender; this is not a live SDK/SSE wire trace.",
      configurationScope: "Offline binding fixture uses current API_AGENT_DEPLOYMENT_DEFAULTS; no persisted user config or credentials read. This does not establish the installed app's current binding values.",
      networkCalls: 0,
      projectWrites: 0,
    };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}
