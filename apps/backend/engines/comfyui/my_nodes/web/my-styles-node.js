// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 漫影风格画廊(09-16 用户令:MyStylesLibrary 节点内瀑布流展示
 * art_skills 风格图,点击单选;替代下拉弹出选择)。
 *
 * 值单一真源=原 style combo(widget.hidden=true 官方位,shot-node 同款):
 * widgets_values 恒 [展示名] 序列化契约零影响;画廊只是它的可视化皮,
 * 点击=写 combo.value+高亮迁移,恒单选。图源=/my_styles/thumb 服务端
 * 缩略图(320px,磁盘缓存),列表=/my_styles/list(与 combo 同一目录册)。
 */

let stylesPromise = null;
const loadStyles = () => {
  if (!stylesPromise) {
    stylesPromise = fetch("/my_styles/list")
      .then((r) => r.json())
      .then((d) => (Array.isArray(d?.styles) ? d.styles : []))
      .catch(() => []);
  }
  return stylesPromise;
};

const CSS_ID = "my-styles-gallery-css";
const injectCss = () => {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.my-styles-gallery{display:flex;flex-direction:column;gap:6px;height:460px;
  color:#dee3dd;font:12px -apple-system,BlinkMacSystemFont,sans-serif;}
.my-styles-head{padding:2px 4px;opacity:.85;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;flex:none;}
.my-styles-flow{flex:1;overflow-y:auto;column-count:3;column-gap:8px;padding:2px;}
.my-styles-card{break-inside:avoid;margin-bottom:8px;border-radius:8px;overflow:hidden;
  cursor:pointer;position:relative;border:2px solid transparent;background:#262b27;
  transition:border-color .12s ease;}
.my-styles-card:hover{border-color:#5b8a6b;}
.my-styles-card.is-selected{border-color:#4d9e6a;}
.my-styles-card img{width:100%;display:block;min-height:44px;background:#1d211e;}
.my-styles-card span{position:absolute;left:0;right:0;bottom:0;padding:4px 6px 3px;
  background:linear-gradient(transparent,rgba(0,0,0,.82));font-size:11px;line-height:1.3;
  max-height:2.7em;overflow:hidden;text-shadow:0 1px 2px rgba(0,0,0,.9);}
.my-styles-card.is-selected span::after{content:" ✓";color:#7fd49a;font-weight:700;}
.my-styles-empty{padding:14px;opacity:.6;line-height:1.6;}`;
  document.head.appendChild(style);
};

app.registerExtension({
  name: "my.styles.gallery",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "MyStylesLibrary") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      try {
        buildGallery(this);
      } catch (error) { /* 画廊失败=回落原生下拉,不挡节点 */ }
      return result;
    };
  },
});

function buildGallery(node) {
  if (node.widgets?.some((w) => w.name === "my-styles-gallery")) return;
  const combo = (node.widgets || []).find((w) => w.name === "style");
  if (!combo) return;
  injectCss();
  // combo.hidden 延迟到画廊真正渲染出卡片后才置(半路失败=回落原生下拉,
  // 不留"下拉藏了画廊又没出来"的死面)

  const box = document.createElement("div");
  box.className = "my-styles-gallery";
  const head = document.createElement("div");
  head.className = "my-styles-head";
  const flow = document.createElement("div");
  flow.className = "my-styles-flow";
  box.append(head, flow);

  const render = (styles) => {
    flow.textContent = "";
    if (!styles.length) {
      head.textContent = "风格画廊:列表为空(/my_styles/list 未就绪或风格库缺失)";
      const empty = document.createElement("div");
      empty.className = "my-styles-empty";
      empty.textContent = "未取到风格列表。请确认引擎已装载 my-nodes 且 art_skills 在位;下方 style 下拉仍可用。";
      flow.appendChild(empty);
      return;
    }
    combo.hidden = true; // 画廊可用才藏下拉(幂等)
    const selected = String(combo.value ?? "");
    head.textContent = `当前:${selected || "未选"} · 共 ${styles.length} 风格`;
    for (const s of styles) {
      const card = document.createElement("div");
      card.className = "my-styles-card" + (s.name === selected ? " is-selected" : "");
      card.dataset.name = s.name;
      card.title = s.name;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = s.name;
      img.src = s.thumb;
      const label = document.createElement("span");
      label.textContent = s.name;
      card.append(img, label);
      card.onclick = () => {
        if (combo.value === s.name) return; // 已选中再点=不动(单选)
        combo.value = s.name;
        try { if (typeof combo.callback === "function") combo.callback(s.name); } catch (e) { /* 无碍 */ }
        head.textContent = `当前:${s.name} · 共 ${styles.length} 风格`;
        for (const el of flow.children) {
          el.classList.toggle("is-selected", el.dataset.name === s.name);
        }
        try { node.setDirtyCanvas(true, true); } catch (e) { /* 无碍 */ }
      };
      flow.appendChild(card);
    }
    const active = flow.querySelector(".is-selected");
    if (active?.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  };

  loadStyles().then(render);
  node.addDOMWidget("my-styles-gallery", "my-styles-gallery", box, {
    hideOnZoom: false,
    getHeight: () => 470,
    getMinHeight: () => 470,
  });
  node.size[0] = Math.max(node.size[0] || 0, 430); // 3 列瀑布流最小可读宽
}
