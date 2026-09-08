// mock client 生命周期测试:走通契约链路(安装→就绪、更新链报告/失败回滚、
// 断点续装、插件装卸与引用扫描),同时充当 UI 无桥时的行为规格说明。

import { describe, expect, it } from "vitest";
import { createMockComfyEngineClient } from "./mock-comfy-engine-client";

/** 把 job 一次推到终态(mock 靠 getJob 轮询推进,最多 20 步兜底)。 */
async function drainJob(client: ReturnType<typeof createMockComfyEngineClient>, jobId: string) {
  let job = await client.getJob(jobId);
  for (let i = 0; i < 20 && job.state === "running"; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    job = await client.getJob(jobId);
  }
  return job;
}

describe("createMockComfyEngineClient 引擎链路", () => {
  it("初始未安装;安装任务推进到成功后装完即就绪(服务未跑,端口已定)", async () => {
    const client = createMockComfyEngineClient();
    expect((await client.getEngineStatus()).state).toBe("not-installed");

    const { jobId } = await client.installEngine();
    const job = await drainJob(client, jobId);
    expect(job.state).toBe("succeeded");

    const status = await client.getEngineStatus();
    expect(status.installed).toBe(true);
    expect(status.state).toBe("ready");
    // 就绪口径裁定:装完即就绪,服务未跑只是副标
    expect(status.serviceRunning).toBe(false);
    expect(status.port).toBe(17599);
    expect(status.version).toBe("0.34.0");
  });

  it("安装各阶段大白话文案推进(下载→依赖→收尾)", async () => {
    const client = createMockComfyEngineClient();
    const { jobId } = await client.installEngine();
    const stages: string[] = [];
    let job = await client.getJob(jobId);
    while (job.state === "running") {
      stages.push(job.stage ?? "");
      job = await client.getJob(jobId);
    }
    expect(stages[0]).toBe("download");
    expect(stages).toContain("dependencies");
    // 终态 job 保留最后一阶段
    expect(job.stage).toBe("finalize");
    expect(job.progress).toBe(100);
  });

  it("断网失败注入:安装失败 → 需准备 + 大白话,可重新安装续上", async () => {
    const client = createMockComfyEngineClient({ failInstall: true });
    const { jobId } = await client.installEngine();
    const job = await drainJob(client, jobId);
    expect(job.state).toBe("failed");
    expect(job.message).toContain("没下完整");

    const status = await client.getEngineStatus();
    expect(status.state).toBe("needs-setup");
    expect(status.message).toContain("断点");

    // 重试(不带失败注入的新 client 模拟重装成功场景由上一用例覆盖)
    const retry = await client.installEngine();
    const retryJob = await drainJob(client, retry.jobId);
    expect(retryJob.state).toBe("succeeded");
    expect((await client.getEngineStatus()).state).toBe("ready");
  });

  it("检查更新发现新版 → 更新链成功出报告(不兼容插件点名)→ 版本跟进", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    const check = await client.checkUpdate();
    expect(check.updateAvailable).toBe(true);
    expect(check.latest).toBe("0.34.5");

    const { jobId } = await client.updateEngine();
    const job = await drainJob(client, jobId);
    expect(job.state).toBe("succeeded");
    expect(job.stage).toBe("verify");
    expect(job.report?.kind).toBe("update");
    if (job.report?.kind === "update") {
      expect(job.report.previousVersion).toBe("0.34.0");
      expect(job.report.newVersion).toBe("0.34.5");
      expect(job.report.nodeCountAfter).toBeGreaterThan(job.report.nodeCountBefore);
      expect(job.report.incompatiblePlugins).toEqual(["图层样式"]);
    }
    const status = await client.getEngineStatus();
    expect(status.version).toBe("0.34.5");
    expect(status.updateAvailable).toBe(false);
  });

  it("更新失败注入:校验失败 job → 一键回滚恢复就绪", async () => {
    const client = createMockComfyEngineClient({
      failUpdate: true,
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    const { jobId } = await client.updateEngine();
    const job = await drainJob(client, jobId);
    expect(job.state).toBe("failed");
    expect(job.message).toContain("校验没通过");

    const rollback = await client.rollbackUpdate();
    expect(rollback.accepted).toBe(true);
    expect((await client.getEngineStatus()).state).toBe("ready");
  });

  it("启动/停止服务翻转 serviceRunning(不影响就绪胶囊口径)", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    expect((await client.getEngineStatus()).serviceRunning).toBe(false);
    await client.startEngine();
    expect((await client.getEngineStatus()).serviceRunning).toBe(true);
    await client.stopEngine();
    expect((await client.getEngineStatus()).serviceRunning).toBe(false);
  });

  it("模型目录自定义与空路径拒绝", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0" },
    });
    const rejected = await client.setModelsDir("  ");
    expect(rejected.accepted).toBe(false);
    const accepted = await client.setModelsDir("/现有模型库/sd-models");
    expect(accepted.accepted).toBe(true);
    expect((await client.getEngineStatus()).modelsDir).toBe("/现有模型库/sd-models");
  });
});

describe("createMockComfyEngineClient 插件链路", () => {
  it("目录搜索 + 安装差分报告(新增 N 个节点)→ 已装清单出现该插件", async () => {
    const client = createMockComfyEngineClient();
    const results = await client.searchCatalog("图层");
    expect(results.map((entry) => entry.id)).toEqual(["layerstyle", "layer-node"]);

    const { jobId } = await client.installPlugin("curated", "layerstyle");
    const job = await drainJob(client, jobId);
    expect(job.state).toBe("succeeded");
    expect(job.report?.kind).toBe("plugin-install");
    if (job.report?.kind === "plugin-install") {
      expect(job.report.pluginId).toBe("layerstyle");
      expect(job.report.addedNodeCount).toBeGreaterThan(0);
    }

    const plugins = await client.listPlugins();
    const layerstyle = plugins.find((plugin) => plugin.id === "layerstyle");
    expect(layerstyle?.state).toBe("installed");
    expect(layerstyle?.nodeCount).toBeGreaterThan(0);
    expect((await client.searchCatalog("图层"))[0]?.installedState).toBe("installed");
  });

  it("卸载前引用扫描:rgthree 有工作流引用,其余为空", async () => {
    const client = createMockComfyEngineClient();
    const usage = await client.getPluginUsage("rgthree");
    expect(usage.workflows.length).toBeGreaterThan(0);
    expect(usage.workflows[0]?.name).toBe("Krea2-NSFW专业流");
    expect((await client.getPluginUsage("layerstyle")).workflows).toEqual([]);
  });

  it("卸载后插件从已装清单消失", async () => {
    const client = createMockComfyEngineClient();
    const { jobId } = await client.installPlugin("curated", "rgthree");
    await drainJob(client, jobId);
    const reply = await client.uninstallPlugin("rgthree");
    expect(reply.accepted).toBe(true);
    const plugins = await client.listPlugins();
    expect(plugins.find((plugin) => plugin.id === "rgthree")?.state).toBe("installable");
  });

  it("任意 git 地址安装(高级通道)与体检报告", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0" },
    });
    const { jobId } = await client.installPlugin("git", "https://example.test/comfyui-x");
    const job = await drainJob(client, jobId);
    expect(job.state).toBe("succeeded");

    const report = await client.doctor();
    expect(report.drifted.length).toBe(1);
  });
});
