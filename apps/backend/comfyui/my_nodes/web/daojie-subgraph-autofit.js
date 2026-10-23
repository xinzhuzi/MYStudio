// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 子图进入自动取景(daojie-subgraph-autofit):
 * ComfyUI 0.37 进入子图的默认视野会漂移(09-21 三次实测 scale 0.35~0.41、
 * x offset 877/1398/1608 各不同,文件层 extra.ds 不被前端恢复),大矩阵
 * 子图(如道劫 [90] 九型×LoRA 配方矩阵)第一眼可能整幅出视口。本扩展在
 * 「进入子图」这一刻按当前子图内容包围盒自动 fitView 一次:进入即全貌,
 * 不再依赖用户手动按「适应视图」。退出子图回主图不干预;用户进入后自行
 * 平移/缩放不会被重置(仅在 graph 引用变化时触发一次)。
 */
import { app } from "/scripts/app.js";

function fitGraphToView(c) {
  const g = c.getCurrentGraph ? c.getCurrentGraph() : c.subgraph;
  if (!g || !g._nodes || !g._nodes.length) return;
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const n of g._nodes) {
    const p = n.pos;
    if (!p || typeof p[0] !== "number") continue;
    const s = n.size && typeof n.size[0] === "number" ? n.size : [100, 100];
    minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
    maxx = Math.max(maxx, p[0] + s[0]); maxy = Math.max(maxy, p[1] + s[1]);
  }
  for (const gr of g._groups || []) {
    const b = gr.bounding;
    if (!b || typeof b[0] !== "number") continue;
    minx = Math.min(minx, b[0]); miny = Math.min(miny, b[1]);
    maxx = Math.max(maxx, b[0] + b[2]); maxy = Math.max(maxy, b[1] + b[3]);
  }
  const el = c.canvas;
  const W = maxx - minx, H = maxy - miny;
  let sc = Math.min(el.clientWidth / (W + 160), el.clientHeight / (H + 120));
  sc = Math.max(0.05, Math.min(4, sc));
  c.ds.scale = sc;
  c.ds.offset[0] = el.clientWidth / 2 - ((minx + maxx) / 2) * sc;
  c.ds.offset[1] = el.clientHeight / 2 - ((miny + maxy) / 2) * sc;
  c.setDirty(true, true);
}

app.registerExtension({
  name: "my.subgraph.autofit",
  setup() {
    // 侦测「当前显示的 graph 引用变化」:进入子图(≠根图)时 fit 一次。
    let last = null;
    const watch = () => {
      try {
        const c = app.canvas;
        if (!c) return;
        const cur = c.getCurrentGraph ? c.getCurrentGraph() : c.subgraph;
        if (cur && cur !== last) {
          last = cur;
          if (cur !== app.graph) fitGraphToView(c); // 仅子图,主图不干预
        }
      } catch (e) { /* 取景失败=保持前端默认,不阻塞 */ }
    };
    const tick = setInterval(watch, 400);
    // 页面卸载时清理,避免重复注册泄漏
    addEventListener("pagehide", () => clearInterval(tick), { once: true });
  },
});
