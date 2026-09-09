// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 存量全量迁移实弹(env 门控;PRD 阶段2 验收「抽检≥10 实弹」):
 *   MANYING_MIGRATE_LIVE=1 且 sidecar(17595)+引擎在跑时执行——
 *   读 ~/Project/IP/MA 真实流文件 → 全量迁移导出 → object_info 校验
 *   缺类 → 抽检≥10 真提交引擎执行(占位参考图=dummy PNG,验迁移保真
 *   非画质)→ 收件箱回写命中。
 *   用法:MANYING_MIGRATE_LIVE=1 npx vitest run --config \
 *     frontend/config/vite.config.ts <本文件> --testTimeout 1800000
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { exportImageWorkflowToComfy, planMigration, referencePlaceholder } from "@/lib/assist/image-studio/workflow-export-comfy";
import type { ImageWorkflowGraph } from "@/types/studio";

const live = process.env.MANYING_MIGRATE_LIVE === "1";
const STORE_DIR = join(process.env.HOME ?? "", "Project/IP/MA/store/studio-workflow");
const SIDECAR = `http://127.0.0.1:${process.env.MANYING_MIGRATE_SIDECAR ?? "17595"}`;
const TOKEN = "manying-local-image";
const d = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadRealFlows(): ImageWorkflowGraph[] {
  const flows: ImageWorkflowGraph[] = [];
  for (const name of readdirSync(STORE_DIR)) {
    if (!name.startsWith("image-workflows-") || !name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(STORE_DIR, name), "utf-8")) as { state?: { imageWorkflows?: ImageWorkflowGraph[] } };
      for (const flow of data.state?.imageWorkflows ?? []) {
        if (planMigration(flow).blocks.length > 0) flows.push(flow);
      }
    } catch {
      // 坏文件跳过(实弹口径:能迁多少迁多少,坏文件入报告)
    }
  }
  return flows;
}

(live ? it : it.skip)("存量全量迁移:校验全部+抽检≥10 真执行", async () => {
  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const status = await (await fetch(`${SIDECAR}/comfy/engine/status`, { headers: auth })).json();
  expect(status.running).toBe(true);
  const engine = `http://127.0.0.1:${status.port}`;
  const objectInfo = await (await fetch(`${engine}/object_info`)).json();
  const available = new Set(Object.keys(objectInfo));
  // 收件箱基线:只认本轮新增(防旧项同目标假命中),先清旧账
  const before = await (await fetch(`${SIDECAR}/comfy/bridge/writebacks?cursor=0&include_image=0`, { headers: auth })).json();
  const inboxBaseline = (before.cursor ?? 0) as number;
  if (inboxBaseline > 0) {
    await fetch(`${SIDECAR}/comfy/bridge/writebacks/ack`, { method: "POST", headers: auth, body: JSON.stringify({ upTo: inboxBaseline }) });
  }

  const flows = loadRealFlows();
  expect(flows.length).toBeGreaterThanOrEqual(10); // PRD 抽检基线:存量≥10 条有块流

  // ① 全量迁移+缺类校验
  const missingByFlow = new Map<string, string[]>();
  let referenceCount = 0;
  for (const flow of flows) {
    const result = exportImageWorkflowToComfy(flow);
    const classes = new Set<string>();
    for (const node of Object.values(result.api as Record<string, { class_type: string }>)) {
      classes.add(node.class_type);
    }
    const missing = [...classes].filter((cls) => !available.has(cls));
    if (missing.length > 0) missingByFlow.set(flow.name, missing);
    referenceCount += result.report.mapped.reference ?? 0;
  }
  console.log(`全量:${flows.length} 流,参考图 ${referenceCount} 张,缺类流 ${missingByFlow.size} 条`, [...missingByFlow.entries()].slice(0, 3));
  expect(missingByFlow.size).toBe(0); // 插件装齐后应零缺类

  // ② 抽检≥10:占位参考图=dummy PNG → 真提交执行 → 收件箱命中
  const dummyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const sample = flows.slice(0, Math.max(10, Math.min(flows.length, 12)));
  let executed = 0;
  let wroteBack = 0;
  for (const flow of sample) {
    const result = exportImageWorkflowToComfy(flow);
    for (const block of planMigration(flow).blocks) {
      for (const [index, reference] of block.references.slice(0, 2).entries()) {
        const name = referencePlaceholder(index, reference.imageUrl);
        await fetch(`${SIDECAR}/comfy/bridge/reference`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ name, imageB64: dummyPng }),
        });
      }
    }
    const submit = await (await fetch(`${engine}/prompt`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ prompt: result.api, client_id: "migrate-batch-live" }),
    })).json();
    expect(submit.node_errors, `${flow.name}: ${JSON.stringify(submit.node_errors).slice(0, 200)}`).toEqual({});
    let statusStr = "";
    for (let i = 0; i < 240 && !statusStr; i += 1) {
      await d(2000);
      const history = await (await fetch(`${engine}/history/${submit.prompt_id}`)).json();
      statusStr = history[submit.prompt_id]?.status?.status_str ?? "";
    }
    expect(statusStr, `${flow.name} 执行未到终态`).toBe("success");
    executed += 1;

    const target = flow.target.kind === "storyboard" && flow.target.id ? flow.target.id : null;
    if (target) {
      const inbox = await (await fetch(`${SIDECAR}/comfy/bridge/writebacks?cursor=${inboxBaseline}&include_image=0`, { headers: auth })).json();
      const hit = (inbox.items as Array<{ shotTarget?: string }>).some((item) => item.shotTarget === target);
      if (hit) wroteBack += 1;
    }
  }
  console.log(`抽检:${executed} 执行 success / ${wroteBack} 收件箱命中(无分镜目标的流不计回写)`);
  expect(executed).toBeGreaterThanOrEqual(10);
  expect(wroteBack).toBe(executed); // 抽检全为分镜流时应全命中
}, 1_800_000);
