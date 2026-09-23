// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 迁移器 live 实弹(env 门控,默认跳过保持套件密闭):
 *   MANYING_MIGRATOR_LIVE=1 且 sidecar(17595)+引擎在跑时执行——
 *   t2i 迁移产物真提交引擎 → K2 真生成 → bridge 收件箱落位。
 *   令牌(0924 起装机随机,sidecar 缺令牌 fail-closed):MANYING_LOCAL_IMAGE_TOKEN
 *   注入(取自 <userData>/python/profiles/image-gen/config.json 的 controlToken)。
 *   用法:MANYING_LOCAL_IMAGE_TOKEN=<token> npx vitest run --config \
 *          frontend/config/vite.config.ts \
 *          frontend/lib/assist/image-studio/workflow-export-comfy.live.test.ts \
 *          --testTimeout 360000
 */

import { expect, it } from "vitest";

import { exportImageWorkflowToComfy } from "@/lib/assist/image-studio/workflow-export-comfy";
import type { ImageWorkflowGraph } from "@/types/studio";

const live = process.env.MANYING_MIGRATOR_LIVE === "1";
const d = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(live ? it : it.skip)("迁移产物全链:引擎执行 K2 生成→bridge 回写→收件箱", async () => {
  const sidecar = "http://127.0.0.1:17595";
  const token = process.env.MANYING_LOCAL_IMAGE_TOKEN ?? "";
  expect(token, "缺 MANYING_LOCAL_IMAGE_TOKEN(装机随机令牌,取自 image-gen config.json 的 controlToken)").toBeTruthy();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const status = await (await fetch(`${sidecar}/comfy/engine/status`, { headers: auth })).json();
  expect(status.running).toBe(true);
  const engine = `http://127.0.0.1:${status.port}`;

  const graph = {
    id: "wf-live", name: "迁移实弹", target: { kind: "storyboard", id: "sb-live-01" },
    nodes: [
      { id: "p1", type: "prompt", prompt: "水墨山色,一叶扁舟,大面积留白", negativePrompt: "模糊,低对比", aspectRatio: "1:1", position: { x: 0, y: 0 } },
      { id: "g1", type: "generated", prompt: "", aspectRatio: "1:1", status: "idle", position: { x: 1, y: 1 } },
    ],
    edges: [{ id: "e1", source: "p1", target: "g1" }],
    createdAt: 0, updatedAt: 0,
  } as unknown as ImageWorkflowGraph;
  const result = exportImageWorkflowToComfy(graph);

  const submit = await (await fetch(`${engine}/prompt`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ prompt: result.api, client_id: "migrator-live" }),
  })).json();
  expect(Object.keys(submit.node_errors)).toEqual([]);
  expect(submit.node_errors).toEqual({});
  expect(submit.prompt_id).toBeTruthy();

  let statusStr = "";
  for (let i = 0; i < 120 && !statusStr; i += 1) {
    await d(2000);
    const history = await (await fetch(`${engine}/history/${submit.prompt_id}`)).json();
    statusStr = history[submit.prompt_id]?.status?.status_str ?? "";
  }
  expect(statusStr, "引擎执行未在时限内到终态").toBe("success");

  const inboxBefore = await (await fetch(`${sidecar}/comfy/bridge/writebacks?cursor=0&include_image=0`, { headers: auth })).json();
  const hit = (inboxBefore.items as Array<{ shotTarget?: string }>).some((item) => item.shotTarget === "sb-live-01");
  expect(hit, "收件箱未见回写项").toBe(true);
}, 360_000);
