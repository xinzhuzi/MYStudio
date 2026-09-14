// @vitest-environment jsdom
// 漫影登录遮蔽(09-10 云端收编;09-11 二轮精确化)行为测试:直取引擎侧真源
// my_login_cloak.js 在 jsdom 里实跑——测的是「随引擎分发的同一份代码」,
// 非 app 侧复制品(两层同码由 ComfyCanvasStudio ?raw 整文件导入保证)。
// 时序约定:元素先建后 install(吃初始 sweep,不赌 MutationObserver 异步)。
// 精确化纪律(09-11 用户实弹打回上一版误杀 Comfy 设置页):炸点仅=登录按钮
// 本体+其「登录您的账户」锚定的卡片,其余任何界面零接触。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

// jsdom 环境 import.meta.url 是 http 协议(file 读不了)→ 按仓库布局从
// process.cwd()(vitest 恒自 apps/ 起)定位引擎侧真源(独立扩展文件,整文件直读)。
const cloakSource = readFileSync(
  path.resolve(process.cwd(), "backend/engines/comfyui/my_nodes/web/my_login_cloak.js"),
  "utf8",
);

function installCloak() {
  window.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  // eslint-disable-next-line no-new-func
  new Function(cloakSource)();
}

function button(text: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = text;
  document.body.append(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  delete (window as { __mySignInCloak?: boolean }).__mySignInCloak;
  delete (window as { MANYING_ACCOUNT_URL?: string }).MANYING_ACCOUNT_URL;
});

describe("myLoginCloak(引擎扩展真源,二轮精确化)", () => {
  it("用户页登录卡:整卡隐藏(按钮+登录您的账户标题+说明一起消失)", () => {
    const card = document.createElement("div");
    const header = document.createElement("div");
    header.textContent = "登录您的账户";
    const desc = document.createElement("p");
    desc.textContent = "登录以保存设置到您的账户并使用云端服务";
    const loginButton = document.createElement("button");
    loginButton.textContent = "登录 / 注册";
    card.append(header, desc, loginButton);
    const unrelated = button("我的用户设置");
    document.body.append(card);
    installCloak();
    expect(card.style.display).toBe("none"); // 整卡
    expect(unrelated.style.display).toBe(""); // 邻居区零接触
  });

  it("英文 Sign in / Log in 按钮同样精确命中", () => {
    const signIn = button("Sign in");
    const logIn = button("Log in");
    installCloak();
    expect(signIn.style.display).toBe("none");
    expect(logIn.style.display).toBe("none");
  });

  it("顶栏纯图标登录钮(aria-label=登录,textContent 空)命中;aria-label 含登录但非整词不命中", () => {
    const iconLogin = document.createElement("button");
    iconLogin.setAttribute("aria-label", "登录");
    iconLogin.innerHTML = "<i class=\"icon-user\"></i>"; // 无文本,名字只在 aria-label
    const vague = document.createElement("button");
    vague.setAttribute("aria-label", "登录提示"); // 上版事故源:包含式 label 匹配
    vague.textContent = "提示";
    document.body.append(iconLogin, vague);
    installCloak();
    expect(iconLogin.style.display).toBe("none");
    expect(vague.style.display).toBe("");
  });

  it("事故回归:Comfy 设置页零接触——普通按钮/仅注册/含登录字样的非精确文案/title 与 aria 提示一律不动", () => {
    // 还原误杀现场形态:设置行=span 标题+说明+开关,title/aria-label 带登录字样
    const section = document.createElement("div");
    const row1 = document.createElement("div");
    const label1 = document.createElement("span");
    label1.textContent = "未登录时也可使用的功能";
    const title1 = document.createElement("button");
    title1.textContent = "运行";
    title1.title = "点击登录后可同步"; // title 含登录——上版误伤源,本版不碰
    const aria1 = document.createElement("button");
    aria1.textContent = "保存";
    aria1.setAttribute("aria-label", "登录提示");
    const signUpOnly = button("注册");
    const longCompound = button("去登录你的账户查看更多内容");
    row1.append(label1, title1, aria1);
    section.append(row1, signUpOnly, longCompound);
    document.body.append(section);
    installCloak();
    expect(section.style.display).toBe("");
    expect(title1.style.display).toBe("");
    expect(aria1.style.display).toBe("");
    expect(signUpOnly.style.display).toBe("");
    expect(longCompound.style.display).toBe("");
    expect(label1.style.display).toBe("");
  });

  it("无卡片锚时只藏按钮本体,不向上扩大", () => {
    const loginButton = button("登录 / 注册"); // 附近没有「登录您的账户」标题
    const sibling = button("运行");
    installCloak();
    expect(loginButton.style.display).toBe("none");
    expect(sibling.style.display).toBe("");
    expect(document.body.style.display).toBe(""); // 绝不连坐容器
  });

  it("设 MANYING_ACCOUNT_URL=换漫影登录:按钮改标转跳,卡片不隐藏", () => {
    (window as { MANYING_ACCOUNT_URL?: string }).MANYING_ACCOUNT_URL = "https://account.manying.example";
    const openStub = vi.fn();
    vi.stubGlobal("open", openStub);
    const card = document.createElement("div");
    const header = document.createElement("div");
    header.textContent = "登录您的账户";
    const loginButton = document.createElement("button");
    loginButton.textContent = "登录 / 注册";
    card.append(header, loginButton);
    document.body.append(card);
    installCloak();
    expect(loginButton.style.display).toBe("");
    expect(loginButton.textContent).toBe("漫影账户");
    expect(card.style.display).toBe(""); // 卡片保留
    loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openStub).toHaveBeenCalledWith("https://account.manying.example", "_blank", "noopener");
    vi.unstubAllGlobals();
  });

  it("幂等:重复安装不炸不重复注册", () => {
    installCloak();
    expect(() => installCloak()).not.toThrow();
  });
});
