// Select 主题契约(1102 第二轮实弹反馈 F1/F2 字面量锁,仿 build-scripts.test.ts 范式):
// F1 弹层透明底——bg-popover 令牌链实机断点,修复=显式 hsl(var(--popover)) 直连变量;
// F2 悬停不可辨——旧高亮态仅 focus:opacity-65 无背景变化,修复=data-[highlighted] 真背景高亮。
// 退回旧写法(令牌类/纯透明度)即红,防回退。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./select.tsx", import.meta.url)), "utf8");

describe("Select 主题契约(1102 F1/F2)", () => {
  it("弹层底色显式直连 --popover 变量(非令牌类,防透明底复发)", () => {
    expect(src).toContain("bg-[hsl(var(--popover))]");
  });

  it("条目高亮=真背景高亮(accent 实底+全不透明,禁纯 opacity 淡出)", () => {
    expect(src).toContain("data-[highlighted]:bg-[hsl(var(--accent))]");
    expect(src).not.toContain("focus:opacity-65");
  });
});
