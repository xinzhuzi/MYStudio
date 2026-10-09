// AC8 实弹验收(09-09-comfy-model-tab):装机版 CDP 驱动——
// 设置→本地配置→展开 ComfyUI 引擎卡,截图并程序化断言三件事:
//   ①默认落「模型」页 ②图片大模型子区完整 ③不触发 GitHub 检查。
// 用法:node build/scripts/comfy-model-tab-ac8-acceptance.mjs(应用须带
// --remote-debugging-port=17654 从终端起)。产物:apps/output/automation/ac8-*.png + 结论 JSON。
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";

const CDP_HTTP = "http://127.0.0.1:17654";
const OUT_DIR = resolve(process.cwd(), "output/automation");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.title.includes("漫影"));
  if (!page) throw new Error("未找到应用页面 target");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });

  let seq = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

  // smoke 同款五连事件(pointerdown+mousedown+pointerup+mouseup+click)
  const clickByText = (selector, text) => evaluate(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((n) => norm(n.textContent).includes(${JSON.stringify(text)}));
    if (!node) return false;
    node.scrollIntoView({ block: 'center' });
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
    return true;
  })()`);

  // 轮询等待条件成立(DOM 断言表达式 → boolean)
  const waitFor = async (expr, label, timeoutMs = 8000) => {
    for (let i = 0; i < timeoutMs / 250; i++) {
      if (await evaluate(expr)) return;
      await sleep(250);
    }
    throw new Error("等待超时: " + label);
  };

  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(resolve(OUT_DIR, name), Buffer.from(data, "base64"));
    return name;
  };

  // ① 导航:设置 → 本地配置(收起态总览:证明生图行已撤)
  if (!(await clickByText('.studio-nav-button', '设置'))) throw new Error("设置导航按钮未找到");
  await sleep(1200);
  if (!(await clickByText('.settings-tabs-bar button', '本地配置'))) throw new Error("本地配置标签未找到");
  await waitFor(`Array.from(document.querySelectorAll('h4')).some((h) => (h.textContent||'').includes('Python 运行环境'))`, "本地配置行挂载");
  await sleep(600);
  await shot("ac8-1-local-config-overview.png");

  // ② 展开 ComfyUI 引擎卡行(默认收起裁定)→ 默认应落「模型」页
  const opened = await evaluate(`(() => {
    const trig = document.querySelector('#plugin-comfy-engine-heading')?.closest('button');
    if (!trig) return 'no-trigger';
    trig.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
    trig.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
    trig.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
    trig.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
    trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
    return 'clicked';
  })()`);
  if (opened !== "clicked") throw new Error("引擎卡行触发器未找到: " + opened);
  await waitFor(`Boolean(document.querySelector('[data-comfy-models-page]'))`, "模型页挂载");
  await sleep(1500);
  await shot("ac8-2-engine-card-models-default.png");

  // ③ 程序化断言(模型页挂载后)
  const facts = await evaluate(`(() => {
    const activeTab = document.querySelector('[data-comfy-tab].bg-accent, [data-comfy-tab][class*="bg-accent"]');
    const githubQuerying = document.body.innerText.includes('正在向 GitHub 查询');
    const modelsPage = Boolean(document.querySelector('[data-comfy-models-page]'));
    const imageSub = document.body.innerText.includes('图片大模型(本地生图,免费)');
    const engineService = document.body.innerText.includes('引擎服务') || document.body.innerText.includes('正在确认引擎状态');
    const modelRow = Array.from(document.querySelectorAll('[data-comfy-models-page] *')).some((n) => /Krea2|Z-Image|Qwen|FLUX/i.test(n.textContent || ''));
    const oldRowGone = !Array.from(document.querySelectorAll('h4')).some((h) => (h.textContent || '').includes('本地图片生成'));
    const oldMusicGone = !Array.from(document.querySelectorAll('h4')).some((h) => (h.textContent || '').includes('本地音乐生成'));
    return {
      activeTabText: activeTab ? activeTab.textContent.trim() : null,
      modelsPage, imageSub, modelRow, engineService, githubQuerying, oldRowGone, oldMusicGone,
    };
  })()`);

  // ④ 点「更新」页对照:GitHub 检查只在此时触发(等 2s 看徽章)
  await clickByText('[data-comfy-tab]', '更新');
  await sleep(2200);
  await shot("ac8-3-update-tab-check-triggered.png");
  const updateFacts = await evaluate(`(() => ({
    githubQuerying: document.body.innerText.includes('正在向 GitHub 查询'),
    versionRow: document.body.innerText.includes('当前版本'),
  }))()`);

  ws.close();
  const verdict = {
    ok: facts.modelsPage && facts.imageSub && facts.oldRowGone && facts.oldMusicGone
      && facts.activeTabText === '模型' && !facts.githubQuerying,
    defaultLandsModels: facts.activeTabText === "模型",
    imageSubsectionComplete: facts.imageSub && facts.modelRow,
    noGithubCheckOnModels: !facts.githubQuerying,
    githubCheckOnUpdateTab: updateFacts.githubQuerying || updateFacts.versionRow,
    legacyRowsGone: facts.oldRowGone && facts.oldMusicGone,
    facts,
  };
  writeFileSync(resolve(OUT_DIR, "ac8-acceptance.json"), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}

main().catch((e) => { console.error("AC8 验收失败:", e.message); process.exit(2); });
