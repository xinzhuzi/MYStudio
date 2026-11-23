import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { API_AGENT_DEPLOYMENT_DEFAULTS } from "@/stores/ai/api-config-agent-deployments";
import { captureProductionAudit, parseProductionAudit, readHookPolicy, type AuditJob } from "./director_chapter001_production_audit_1027.capture";

const fixture = vi.hoisted(() => ({ temperature: undefined as number | undefined, useDefault: true }));
vi.mock("@/lib/ai/config/store-adapter", () => ({
  getAIConfigStore: () => ({
    getResolvedAgentModel: (key: string) => {
      const deployment = API_AGENT_DEPLOYMENT_DEFAULTS.find((item) => item.key === key);
      if (!deployment) throw new Error("unknown_offline_binding");
      return {
        deployment: { ...deployment, temperature: fixture.useDefault ? deployment.temperature : fixture.temperature },
        provider: { id: "offline-production-audit", name: "Offline fixture", platform: "custom", apiProtocol: "anthropic-compatible", baseUrl: "https://offline.invalid/v1", apiKey: "", model: ["glm-5.3"] },
        model: "glm-5.3",
      };
    },
  }),
  getModelEndpointTypes: () => [],
  getAIConcurrency: () => 1,
}));
afterEach(() => { fixture.useDefault = true; fixture.temperature = undefined; });
const script = "# 第一章\n# 范围与目标：原文改编 | 时长：1分钟\n# 已确定要求：保真\n## 剧情梗概\n甲站着。\n1 谷口/日 ·约60秒\n甲站着。\n## 改编追踪\n原文对应。";
const job: AuditJob = { stage: "script", input: { episodeId: "chapter-001", chapterText: "甲站着。", bibleContext: "甲是人物。" }, scriptText: script, planRaw: "", outputText: script };
it("uses the actual hook and manager floor instead of the old audit bridge budget", async () => {
  const captured = await captureProductionAudit(job);
  const ipc = captured.ipcRequest as Record<string, unknown>;
  const request = captured.request as Record<string, unknown>;
  expect(captured.structurePassed).toBe(true);
  expect(ipc.maxTokens).toBe(65536);
  expect(request.max_tokens).toBe(ipc.maxTokens);
  expect(ipc.temperature).toBe(API_AGENT_DEPLOYMENT_DEFAULTS.find((item) => item.key === "scriptDraft")!.temperature);
  expect(request).not.toHaveProperty("thinking");
  expect(captured.ipcUndefinedKeys).toContain("disableThinking");
  expect(captured.hookRequest).not.toHaveProperty("maxTokens");
  expect(captured.hookRequest).not.toHaveProperty("disableThinking");
});
it("lets manager deployment temperature override hook temperature and retains its fallback", async () => {
  fixture.useDefault = false;
  fixture.temperature = 0.83;
  expect((await captureProductionAudit(job)).ipcRequest).toMatchObject({ temperature: 0.83 });
  fixture.temperature = undefined;
  expect((await captureProductionAudit(job)).ipcRequest).toMatchObject({ temperature: 0.2 });
});
it("refuses malformed script before capturing an IPC request", async () => {
  await expect(captureProductionAudit({ ...job, outputText: "bad" })).rejects.toThrow("production_structure_rejected");
});
const input = process.env.DIRECTOR_PRODUCTION_AUDIT_INPUT;
const output = process.env.DIRECTOR_PRODUCTION_AUDIT_OUTPUT;
it.skipIf(!input || !output)("offline real production builder / manager bridge", async () => {
  const research = realpathSync(path.resolve("../.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research"));
  for (const file of [input!, output!]) {
    expect(realpathSync(path.dirname(file)).startsWith(research + path.sep) || realpathSync(path.dirname(file)) === research).toBe(true);
    expect(path.basename(file).startsWith("continue-audit-tool-review-1027-")).toBe(true);
  }
  const value = JSON.parse(readFileSync(input!, "utf8"));
  const captured = value.operation === "parse" ? { review: await parseProductionAudit(value, value.response) } : await captureProductionAudit(value);
  writeFileSync(output!, JSON.stringify(captured, null, 2) + "\n", { flag: "wx" });
});

it.each(["script", "planning", "storyboard"] as const)("reads the unique %s audit callback from current source", (stage) => {
  const policy = readHookPolicy(stage);
  expect(policy.callback).toContain("aiManager.textStream");
  expect(policy.callback).not.toContain("maxTokens");
  expect(policy.callback).not.toContain("disableThinking");
  expect(Object.values(policy.constants).every((value) => value > 0)).toBe(true);
});
it("parses original model JSON without repair and keeps failed or truncated wire rejected", async () => {
  const dimensions = ["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"];
  const wire = JSON.stringify({ protocolVersion: "indexed-kind-table-v1", stage: "script", passed: true,
    checks: Object.fromEntries(dimensions.map((key) => [key, true])),
    classifications: [{ outputQuoteIndex: 4, kind: "physical_fact" }],
    evidence: Object.fromEntries(dimensions.map((key) => [key, [{ outputQuoteIndex: 4, sourceQuoteIndex: 0, sourceKind: "chapter", supported: true, reason: "原文对应" }]])), findings: [] });
  const parsed = await parseProductionAudit(job, { success: true, text: wire });
  expect(parsed.passed).toBe(true);
  expect(parsed.report).toContain(wire);
  expect((await parseProductionAudit(job, { success: false, text: wire, error: "truncated" })).passed).toBe(false);
  expect((await parseProductionAudit(job, { success: true, text: wire.slice(0, -1) })).passed).toBe(false);
  expect((await parseProductionAudit(job, { success: true, text: wire.replace("indexed-kind-table-v1", "unknown") })).passed).toBe(false);
});
