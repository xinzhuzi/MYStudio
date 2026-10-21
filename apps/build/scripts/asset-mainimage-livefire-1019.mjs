/**
 * 资产主图删除断链修复·装机实弹回归(1019, 修复 013214f7)
 *
 * 验证口径(三级口径纪律:本脚本=①实弹级):
 *   A. 真装机 App + 真实资产库 + 真实 IPC:addAsset(带图) 只写行级 filePath、
 *      images[] 恒 '[]'(=生成写回型断链态的确定性复现)→ studioAssets.removeImage
 *      走 10-19 回退分支:应返回非 null 且行级 filePath 清空(修复前=null=「删除失败」)。
 *   B. 对照组:对不存在的路径 removeImage → 仍 null(未命中语义不被修复破坏)。
 *   C. 净清理:临时资产 delete 并复核消失(对真实库净零残留)。
 *
 * 用法: node apps/build/scripts/asset-mainimage-livefire-1019.mjs
 * 前置:装机 App 未在跑(脚本只 spawn 自己的实例,结束即退)。
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const APP_BIN = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const SRC_PNG = `${process.env.HOME}/Library/Application Support/漫影工作室/asset-livefire-1019.png`;
const log = (...a) => console.log("[livefire]", ...a);
const fail = (msg) => {
  console.error("[livefire] ❌ " + msg);
  process.exitCode = 1;
};

async function isPortFree(p) {
  try {
    await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(400) });
    return false;
  } catch {
    return true;
  }
}
async function pickPort() {
  for (let p = 9230; p <= 9239; p += 1) if (await isPortFree(p)) return p;
  throw new Error("9230-9239 无空闲口");
}

function attach(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    let seq = 0;
    const pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.on("open", () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const id = ++seq;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close(),
      }),
    );
    ws.on("error", reject);
  });
}

async function main() {
  // 最小合法 PNG(1×1):copyFileSync 与 sips 缩略均只按文件处理,不校内容
  writeFileSync(
    SRC_PNG,
    Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082",
      "hex",
    ),
  );
  const port = await pickPort();
  log("spawn 装机 App, CDP port", port);
  const appProc = spawn(APP_BIN, [`--remote-debugging-port=${port}`], { stdio: "ignore" });
  let page = null;
  for (let i = 0; i < 90 && !page; i += 1) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === "page" && !t.url.includes("devtools")) || null;
    } catch {
      /* boot 中 */
    }
  }
  if (!page) throw new Error("CDP 90s 未就绪");
  const cdp = await attach(page.webSocketDebuggerUrl);
  log("已附着:", page.title || page.url.slice(0, 60));
  const ev = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("evaluate 异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  try {
    // ── A. 断链态复现 + 修复验证 ──
    const created = await ev(`window.studioAssets.add({ type: 'role', name: 'CDP实弹回归临时1019', sourceFilePath: '${SRC_PNG}' })`);
    if (!created || !created.id) throw new Error("add 未返回资产");
    const got = await ev(`window.studioAssets.get('${created.id}')`);
    log("A0 建资产:", got.id, "| 行级 filePath:", got.filePath, "| images[]:", JSON.stringify(got.images));
    if (!got.filePath) fail("A0 断链态未复现(行级 filePath 为空)");
    if (got.images && got.images.length) fail("A0 断链态未复现(images[] 非空)");

    const removed = await ev(`window.studioAssets.removeImage({ assetId: '${created.id}', imageFilePath: ${JSON.stringify(got.filePath)} })`);
    if (removed === null || removed === undefined) {
      fail("A1 主图删除仍失败(返回 null)——修复未生效");
    } else {
      const after = await ev(`window.studioAssets.get('${created.id}')`);
      if ((after.filePath ?? "") !== "") fail("A1 返回非空但行级 filePath 未清:" + after.filePath);
      else log("A1 ✅ 主图(行级断链态)删除成功,filePath 已清,资产仍在(描述等无损)");
    }

    // ── B. 未命中对照组 ──
    const miss = await ev(`window.studioAssets.removeImage({ assetId: '${created.id}', imageFilePath: 'role/不存在/假路径.png' })`);
    if (miss !== null && miss !== undefined) fail("B 对照组语义破坏:未命中竟返回非空");
    else log("B ✅ 未命中仍返回 null(语义未破)");

    // ── C. 净清理 ──
    await ev(`window.studioAssets.delete('${created.id}')`);
    const gone = await ev(`window.studioAssets.get('${created.id}')`);
    if (gone === null || gone === undefined) log("C ✅ 临时资产已删净(真实库零残留)");
    else fail("C 清理失败:资产仍存在");
  } finally {
    cdp.close();
    if (existsSync(SRC_PNG)) unlinkSync(SRC_PNG);
    appProc.kill("SIGTERM");
    await sleep(1500);
    if (appProc.exitCode === null) appProc.kill("SIGKILL");
    log("App 已收");
  }
}

main().catch((e) => {
  console.error("[livefire] 💥", e.message);
  process.exit(1);
});
