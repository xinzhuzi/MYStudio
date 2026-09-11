// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// ── 云端收编:封 comfy.org 登录入口(09-10,零 ComfyUI 源码) ─────────────
// 用户裁定:云端节点保留,但 comfy.org 登录不出现(账号体系=漫影)。本扩展随
// 引擎 custom_nodes 分发——装机旧版 app 重启引擎即生效,不依赖 app 打包;
// 外部浏览器直访引擎同样覆盖。
//
// 09-11 二轮纠偏(用户实弹打回):上一版「包含匹配+宽扫描面(div/span/p/li/
// title/aria)」把 Comfy 设置页整页误杀。本版精确制导,炸点收窄到两处:
//   1) 按钮=「整文案精确等于」登录类词(空白折叠:登录 / 注册、登录、登入、
//      登陸、Sign in、Log in)——只动按钮本体;
//   2) 卡片=从命中按钮向上找「包含『登录您的账户』标题的最小祖先」,整卡
//      隐藏(只藏按钮会留裸标题);找不到锚=只藏按钮。
// 不扫容器文本、不匹配 title/aria-label、不碰弹窗、不拦点击——Comfy 设置页
// 之类的无关界面零接触。上游 i18n 改词导致漏遮时,凭据补丁(cloud_takeover)
// 仍是功能层兜底:杂散 comfy.org token 永不被采用。
// 换漫影登录的口子:宿主设 window.MANYING_ACCOUNT_URL 后,命中按钮改标
// 「漫影账户」并点击转跳该网址(卡片不隐藏)。
(function manyingLoginCloak() {
  if (window.__manyingSignInCloak) return;
  window.__manyingSignInCloak = true;

  const normalize = (text) => (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  const BUTTON_SET = new Set(["登录 / 注册", "登录", "登入", "登陸", "sign in", "log in"].map(normalize));
  const CARD_ANCHORS = ["登录您的账户", "log in to your account", "sign in to your account"];
  const ACCOUNT_URL = (window.MANYING_ACCOUNT_URL || "").trim();
  const INTERACTIVE = 'button, a, [role="button"]';
  let accountButtonDone = false;

  const isLoginButton = (el) => {
    if (BUTTON_SET.has(normalize(el.textContent))) return true;
    // 顶栏登录=纯图标钮(textContent 空,名字在 aria-label)——09-11 实弹漏网。
    // 只做「整条 label 精确等于」登录词,与文本侧同规:零包含误伤面。
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
    return label ? BUTTON_SET.has(normalize(label)) : false;
  };

  const hideCardOrButton = (button) => {
    if (ACCOUNT_URL && !accountButtonDone) {
      accountButtonDone = true;
      button.textContent = "漫影账户";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open(ACCOUNT_URL, "_blank", "noopener");
      });
      return;
    }
    // 向上找同时含按钮与「登录您的账户」标题的最小容器=登录卡(≤8 层护栏)
    let card = null;
    let node = button.parentElement;
    for (let depth = 0; depth < 8 && node && !card; depth++, node = node.parentElement) {
      if (CARD_ANCHORS.some((anchor) => (node.textContent || "").includes(anchor))) card = node;
    }
    (card || button).style.setProperty("display", "none", "important");
  };

  const sweep = () => {
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (isLoginButton(el)) hideCardOrButton(el);
    }
  };

  const observe = () => {
    sweep();
    new MutationObserver(() => requestAnimationFrame(sweep))
      .observe(document.body, { subtree: true, childList: true });
  };
  if (document.body) observe();
  else document.addEventListener("DOMContentLoaded", observe);
})();
