import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const appsRoot = resolve(__dirname, "..");
const capability = {
  schemaVersion: "daojie-reference-capability-v1",
  status: "verified",
  supportedReferenceCount: 2,
  referenceRoleOrder: [
    "scene-viewpoint",
    "canonical",
    "prop-state",
    "previous-approved-frame",
    "style-reference",
  ],
  evidence: {
    kind: "no-network-test",
    checkedAt: "2026-07-19",
    detail: "Vitest fixture",
  },
  semanticRoleEvidence: {
    status: "unverified",
    providerRoleMetadataSent: false,
    bindingMechanism: "prompt-markers-plus-ordered-images",
    detail: "The provider payload has no native reference-role fields.",
  },
  styleReference: { enabled: false, sha256: null },
};

function runHelper(payload: object) {
  return spawnSync("node", ["build/generate-storyboard-image.mjs"], {
    cwd: appsRoot,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

function runHelperAsync(payload: object): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("node", ["build/generate-storyboard-image.mjs"], {
      cwd: appsRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("generate-storyboard-image V2 contract", () => {
  it("sends the reviewed V2 prompt without transport-layer mutation", () => {
    const result = runHelper({
      dryRun: true,
      prompt: "Daijie dock scene",
      styleContractVersion: "daojie-gongbi-v2",
      referenceImages: ["placeholder"],
      referenceRoles: ["scene-viewpoint"],
      referenceCapability: capability,
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.generationEndpointCalled).toBe(false);
    expect(report.prompt).toBe("Daijie dock scene");
    expect(report.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.promptPolicy).toBe("exact-reviewed-v2");
    expect(report.prompt).not.toContain("clean image");
    expect(report.prompt).not.toContain("low visual noise");
    expect(report.prompt).not.toContain("dirty texture");
    expect(report.prompt).not.toContain("unwanted calligraphy");
    expect(report.providerRoleMetadataSent).toBe(false);
    expect(report.semanticRoleEvidence.status).toBe("unverified");
  });

  it("keeps the legacy clean-image suffix outside the V2 contract", () => {
    const result = runHelper({
      dryRun: true,
      prompt: "Legacy storyboard prompt",
      referenceImages: [],
      referenceRoles: [],
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.promptPolicy).toBe("legacy-enhanced");
    expect(report.prompt).toContain("clean image");
    expect(report.prompt).toContain("do not render any calligraphy");
    expect(report.prompt).not.toContain("dirty texture");
  });

  it("fails closed before reference transfer when V2 capacity is unverified", () => {
    const result = runHelper({
      dryRun: true,
      prompt: "Daijie dock scene",
      styleContractVersion: "daojie-gongbi-v2",
      referenceImages: ["this-file-must-never-be-read.png"],
      referenceRoles: ["scene-viewpoint"],
      referenceCapability: {
        schemaVersion: "daojie-reference-capability-v1",
        status: "unverified",
        reason: "no provider evidence",
        styleReference: { enabled: false, sha256: null },
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("capability is unverified");
    expect(result.stderr).not.toContain("reference image decode failed");
  });

  it("rejects an out-of-order V2 reference list before transfer", () => {
    const result = runHelper({
      dryRun: true,
      prompt: "Daijie dock scene",
      styleContractVersion: "daojie-gongbi-v2",
      referenceImages: ["first-must-not-be-read.png", "second-must-not-be-read.png"],
      referenceRoles: ["canonical", "scene-viewpoint"],
      referenceCapability: capability,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("role order is invalid");
    expect(result.stderr).not.toContain("reference image decode failed");
  });

  it("accepts the production prop-state role before transfer", () => {
    const result = runHelper({
      dryRun: true,
      prompt: "Daijie dock scene",
      styleContractVersion: "daojie-gongbi-v2",
      referenceImages: ["first-must-not-be-read.png", "second-must-not-be-read.png"],
      referenceRoles: ["scene-viewpoint", "prop-state"],
      referenceCapability: capability,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).generationEndpointCalled).toBe(false);
  });

  it("uses ordered multipart image parts for the Toonflow-compatible edit mode", async () => {
    let requestPath = "";
    let contentType = "";
    let requestBody = "";
    const server = createServer((request, response) => {
      requestPath = request.url || "";
      contentType = String(request.headers["content-type"] || "");
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requestBody = Buffer.concat(chunks).toString("latin1");
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data: [{ url: "https://example.invalid/shot-001.png" }] }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server did not expose a port");
    const imageBytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#f6f0e3" },
    }).png().toBuffer();
    const image = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const editCapability = {
      ...capability,
      requestMode: "openai-image-edits",
      referenceTransportStrategy: "primary-per-asset",
    };

    try {
      const result = await runHelperAsync({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "test-key",
        model: "gpt-image-2",
        providerName: "toonflow-local-ai",
        prompt: "ordered edit request",
        referenceImages: [image, image],
        referenceRoles: ["scene-viewpoint", "canonical"],
        referenceCapability: editCapability,
        styleContractVersion: "daojie-gongbi-v2",
        requestMode: "openai-image-edits",
        asyncMode: false,
        resolution: "1K",
        aspectRatio: "16:9",
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(requestPath).toBe("/v1/images/edits");
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(requestBody).not.toContain("image_urls");
      const markers = [
        'name="model"',
        'name="prompt"',
        'name="size"',
        'name="quality"',
        'name="image"; filename="reference-1.png"',
        'name="image"; filename="reference-2.png"',
      ];
      const positions = markers.map((marker) => requestBody.indexOf(marker));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(requestBody).toContain("1536x1024");
      expect(requestBody).toContain("low");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("rejects asynchronous image-edit mode before network access", () => {
    const result = runHelper({
      dryRun: true,
      prompt: "must not run",
      referenceImages: ["must-not-be-read.png"],
      referenceRoles: ["scene-viewpoint"],
      referenceCapability: { ...capability, requestMode: "openai-image-edits" },
      styleContractVersion: "daojie-gongbi-v2",
      requestMode: "openai-image-edits",
      asyncMode: true,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires asyncMode=false");
    expect(result.stderr).not.toContain("reference image decode failed");
  });

  it("blocks a duplicate paid multipart request before a second POST", async () => {
    let postCount = 0;
    const server = createServer((request, response) => {
      postCount += 1;
      request.resume();
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data: [{ url: "https://example.invalid/shot-001.png" }] }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server did not expose a port");
    const imageBytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#b45f4a" },
    }).png().toBuffer();
    const ledgerPath = resolve(mkdtempSync(resolve(tmpdir(), "mystudio-edit-ledger-")), "paid.jsonl");
    const payload = {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "test-key",
      model: "gpt-image-2",
      prompt: "duplicate boundary test",
      referenceImages: [`data:image/png;base64,${imageBytes.toString("base64")}`],
      referenceRoles: ["scene-viewpoint"],
      referenceCapability: { ...capability, requestMode: "openai-image-edits" },
      styleContractVersion: "daojie-gongbi-v2",
      requestMode: "openai-image-edits",
      asyncMode: false,
      singleAttempt: true,
      paidRequestLedgerPath: ledgerPath,
      paidAuthorization: true,
      logicalJob: "chapter-001-v2-pilot",
      logicalShot: "shot-001",
    };

    try {
      const first = await runHelperAsync({ ...payload, attemptId: "attempt-first" });
      const second = await runHelperAsync({ ...payload, attemptId: "attempt-second" });

      expect(first.status).toBe(0);
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("fingerprint already has COMPLETED evidence");
      expect(postCount).toBe(1);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("stops image-edit key fallback after one ambiguous 5xx POST", async () => {
    let postCount = 0;
    const server = createServer((request, response) => {
      postCount += 1;
      request.resume();
      request.on("end", () => {
        response.statusCode = 503;
        response.end("temporarily unavailable");
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server did not expose a port");
    const imageBytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#4a7892" },
    }).png().toBuffer();

    try {
      const result = await runHelperAsync({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKeys: ["first-key", "second-key"],
        model: "gpt-image-2",
        prompt: "ambiguous fallback test",
        referenceImages: [`data:image/png;base64,${imageBytes.toString("base64")}`],
        referenceRoles: ["scene-viewpoint"],
        referenceCapability: { ...capability, requestMode: "openai-image-edits" },
        styleContractVersion: "daojie-gongbi-v2",
        requestMode: "openai-image-edits",
        asyncMode: false,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("automatic provider/key fallback stopped");
      expect(postCount).toBe(1);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
