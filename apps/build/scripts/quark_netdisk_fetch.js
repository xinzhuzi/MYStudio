#!/usr/bin/env node
/**
 * quark_netdisk_fetch.js — 夸克网盘分享链接自动下载器（2026-10-29 首版，实测下载 38期编剧 skill 成功）
 *
 * 用法:
 *   node quark_netdisk_fetch.js <分享URL> [--match 关键词1,关键词2] [--dest 目录] [--keep-quark]
 * 例:
 *   node quark_netdisk_fetch.js 'https://pan.quark.cn/s/6959f1e185ac' --match 'deepwhite-screenwriting' --dest ~/Downloads/夸克
 *
 * 原理（不通外网第三方工具，纯本机链路，2026-10-29 实战打通）:
 *   1. 夸克客户端(Chromium内核)带 --remote-debugging-port 拉起 → CDP
 *   2. 页面上下文 fetch 走夸克官方 API（credentials:'include' 自动带登录态）:
 *      sharepage/token(匿名) → sharepage/detail(匿名列目录) → sharepage/save(转存到自己网盘)
 *      → task 轮询拿新 fid → file/download 拿预签名直链
 *   3. curl 直链下载（CDN 必须带 Referer https://pan.quark.cn/ + 浏览器 UA + Cookie，缺一 412）
 *   4. 下载完 file/delete 清理转存件（失败不阻断，只提示）
 *
 * 登录态说明（关键坑）:
 *   - 夸克客户端浏览器上下文默认【未登录】网盘网页；登录态活在内嵌分区，密钥在数据保护钥匙串读不到。
 *   - 实测登录引导：Chrome「Profile 1」若存有 .quark.cn 登录 cookie（Chrome Safe Storage 钥匙串钥可解），
 *     注入到夸克页面会话(Network.setCookie 于 page session)后刷新页面即得活会话。
 *   - 若注入路不通：先人工在夸克客户端里点开一次网盘（同步登录），再跑本脚本。
 *
 * 已知边界:
 *   - file/sort 与 file/info 会被页面 AWSC 风控钩拦 fetch（Failed to fetch）——本脚本绕开（task 拿 fid、按体量对名）
 *   - 转存件 delete 的 body 形态随版本漂移，失败时文件留在自己网盘根目录（无害，可手动删）
 *   - 分享目录体量>单页 50 需翻页（_page 递增），本脚本默认单页；深目录需按 fid 逐层下钻
 */
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9222;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const QUARK_BIN = '/Applications/Quark.app/Contents/MacOS/Quark';

const args = process.argv.slice(2);
const shareUrl = args.find(a => a.startsWith('https://pan.quark.cn/'));
const matchArg = (args.indexOf('--match') >= 0 && args[args.indexOf('--match') + 1]) || '';
const dest = (args.indexOf('--dest') >= 0 && args[args.indexOf('--dest') + 1]) || path.join(os.homedir(), 'Downloads/夸克');
const keepQuark = args.includes('--keep-quark');
if (!shareUrl) { console.error('用法: quark_netdisk_fetch.js <分享URL> [--match 词,词] [--dest 目录] [--keep-quark]'); process.exit(1); }
const pwdId = shareUrl.split('/s/')[1].split(/[?#]/)[0];
const matches = matchArg ? matchArg.split(',').map(s => s.trim()) : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureCdp() {
  try { await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) }); return false; } catch {}
  spawn(QUARK_BIN, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 15; i++) { await sleep(1000); try { await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) }); return true; } catch {} }
  throw new Error('夸克 CDP 拉起失败');
}

async function cdp() {
  const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let seq = 0; const pend = new Map();
  ws.onmessage = e => { const d = JSON.parse(e.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p = {}, sid) => new Promise(res => { const i = ++seq; pend.set(i, res); const msg = { id: i, method: m, params: p }; if (sid) msg.sessionId = sid; ws.send(JSON.stringify(msg)); });
  return { ws, send };
}

function chromeCookieInject(send, s) { /* 留登录引导接口：见文件头「登录态说明」 */ }

async function main() {
  const weLaunched = await ensureCdp();
  fs.mkdirSync(dest, { recursive: true });
  const { ws, send } = await cdp();
  try {
    const t = await send('Target.createTarget', { url: `https://pan.quark.cn/s/${pwdId}` });
    const tid = t.result.targetId;
    await sleep(9000);
    const s = await send('Target.attachToTarget', { targetId: tid, flatten: true });
    const sid = s.result.sessionId;
    await send('Runtime.enable', {}, sid);
    const run = async js => {
      const ev = await send('Runtime.evaluate', { expression: `(async()=>{try{${js}}catch(e){return {__err:String(e)}}})()`, awaitPromise: true, returnByValue: true }, sid);
      return ev.result.result && ev.result.result.value;
    };
    // ① 列根目录（匿名 token + detail）
    const list1 = await run(`
      const tk=await fetch('https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({pwd_id:'${pwdId}',passcode:''})}).then(r=>r.json());
      if(tk.code!==0)return{err:'token '+tk.code};
      window.__ST=tk.data.stoken;
      const d=await fetch('https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?pr=ucpro&fr=pc&pwd_id=${pwdId}&stoken='+encodeURIComponent(window.__ST)+'&pdir_fid=0&_page=1&_size=50&_fetch_total=1&_sort=file_type:asc,file_name:asc',{credentials:'include'}).then(r=>r.json());
      if(d.code!==0)return{err:'detail '+d.code};
      return d.data.list.map(f=>({fid:f.fid,name:f.file_name,dir:!!f.dir,size:f.size}));
    `);
    if (!list1 || list1.__err || !Array.isArray(list1)) throw new Error('列目录失败: ' + JSON.stringify(list1));
    console.log('分享根目录', list1.length, '项');
    // 目标层：--match 命中的目录下钻一层找文件（简化：仅下钻一层）
    let pool = [];
    const dirs = list1.filter(x => x.dir && (!matches || matches.some(m => x.name.includes(m))));
    const files0 = list1.filter(x => !x.dir && matches && matches.some(m => x.name.includes(m)));
    pool = files0.map(f => ({ ...f, tok: null }));
    for (const d of dirs) {
      const sub = await run(`
        const d=await fetch('https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?pr=ucpro&fr=pc&pwd_id=${pwdId}&stoken='+encodeURIComponent(window.__ST)+'&pdir_fid=${d.fid}&_page=1&_size=100&_fetch_total=1&_sort=file_type:asc,file_name:asc',{credentials:'include'}).then(r=>r.json());
        if(d.code!==0)return [];
        window.__TOKS=window.__TOKS||{}; d.data.list.forEach(x=>window.__TOKS[x.fid]=x.share_fid_token);
        return d.data.list.map(f=>({fid:f.fid,name:f.file_name,size:f.size}));
      `);
      (sub || []).forEach(f => { if (!matches || matches.some(m => f.name.includes(m))) pool.push(f); });
    }
    if (!pool.length) throw new Error('未匹配到文件' + (matches ? '(关键词:' + matches.join(',') + ')' : '（缺 --match？）'));
    // ② 转存
    const toks = await run(`return window.__TOKS||{}`);
    const fids = pool.map(f => f.fid);
    const toksArr = pool.map(f => toks[f.fid]).filter(Boolean);
    if (toksArr.length !== fids.length) throw new Error('share_fid_token 不齐（目标层直取文件时未记录 token——把 --match 指到目录再试）');
    const save = await run(`
      const r=await fetch('https://drive-pc.quark.cn/1/clouddrive/share/sharepage/save?pr=ucpro&fr=pc',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({pwd_id:'${pwdId}',stoken:window.__ST,fid_list:${JSON.stringify(fids)},fid_token_list:${JSON.stringify(toksArr)},to_pdir_fid:'0',scene:'link'})}).then(x=>x.json());
      return {code:r.code,msg:r.message,task:r.data&&r.data.task_id};
    `);
    if (!save || save.code !== 0) throw new Error('转存失败: ' + JSON.stringify(save));
    console.log('转存 OK, task', save.task);
    // ③ task 轮询拿新 fid
    let newFids = null;
    for (let i = 0; i < 20; i++) {
      const q = await run(`
        const r=await fetch('https://drive-pc.quark.cn/1/clouddrive/task?pr=ucpro&fr=pc&task_id=${save.task}&retry_index=${i}',{credentials:'include'}).then(x=>x.json());
        if(r.code===0&&r.data&&r.data.status===2&&r.data.save_as) return r.data.save_as.save_as_top_fids||null;
        return null;
      `);
      if (Array.isArray(q)) { newFids = q; break; }
      await sleep(1500);
    }
    if (!newFids) throw new Error('task 轮询未拿到新 fid');
    // ④ 下载直链
    const dl = await run(`
      const r=await fetch('https://drive-pc.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({fids:${JSON.stringify(newFids)}})}).then(x=>x.json());
      if(r.code!==0)return {err:r.code+' '+r.message};
      return r.data.map(d=>d.download_url);
    `);
    if (!dl || dl.err) throw new Error('取直链失败: ' + JSON.stringify(dl));
    // ⑤ 收页面 cookie 供 CDN 下载（CDN 412 三件套: Referer+UA+Cookie）
    await send('Network.enable', {}, sid);
    const ck = await send('Network.getCookies', { urls: ['https://pan.quark.cn/'] }, sid);
    const cookie = (ck.result.cookies || []).filter(c => c.domain.endsWith('quark.cn')).map(c => `${c.name}=${c.value}`).join('; ');
    // ⑥ 下载 + 按体量对名
    const sizes = pool.reduce((m, f) => (m[f.name] = null, m), {});
    const list2 = await run(`void 0`); // (名字对齐: 下载后按 Content-Length 与 detail size 比对)
    let ok = 0;
    for (let i = 0; i < newFids.length; i++) {
      const out = `/tmp/quark_fetch_${i}.bin`;
      execSync(`curl -s -m 600 -L -o ${JSON.stringify(out)} -H 'Referer: https://pan.quark.cn/' -H ${JSON.stringify('User-Agent: ' + UA)} -H ${JSON.stringify('Cookie: ' + cookie)} ${JSON.stringify(dl[i])}`);
      const sz = fs.statSync(out).size;
      const nm = (pool.find(p => (p.size === sz)) || {}).name || `fid_${newFids[i].slice(0, 8)}_${sz}B.bin`;
      fs.renameSync(out, path.join(dest, nm));
      console.log(`✅ ${nm} (${sz}B)`); ok++;
    }
    // ⑦ 清理转存件（失败不阻断）
    const del = await run(`
      const r=await fetch('https://drive-pc.quark.cn/1/clouddrive/file/delete?pr=ucpro&fr=pc',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({fids:${JSON.stringify(newFids)}})}).then(x=>x.json());
      return r.code;
    `);
    if (del !== 0) console.log('⚠️ 转存件清理未成(code=' + del + ')，文件留在自己网盘根目录，可手动删');
    await send('Target.closeTarget', { targetId: tid });
    console.log(`完成 ${ok}/${newFids.length} → ${dest}`);
  } finally {
    ws.close();
    if (weLaunched && !keepQuark) { try { execSync(`osascript -e 'tell application "Quark" to quit'`, { stdio: 'ignore' }); } catch {} }
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
