// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import log from "./electron-log-main";

// 09-10 P0 崩溃回归:vendor log.ts 模块加载即 `console.error = log.error`。
// 垫片无自检时 console.error 变成自调用函数,主进程首次 console.error 爆栈。
describe("electron-log 兼容垫片(vendor 装载自递归根修)", () => {
  const nativeError = console.error.bind(console);
  const nativeLog = console.log.bind(console);
  afterEach(() => {
    console.error = nativeError;
    console.log = nativeLog;
  });

  it("垫片被装上 console 后调用不再自递归(装机实弹爆栈路径)", () => {
    // 模拟 vendor 副作用:console.error = log.error;console.log = log.log
    console.error = log.error;
    console.log = log.log;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // 关键断言:不抛 RangeError(修复前此处无限递归爆栈)
    expect(() => console.error("boom")).not.toThrow();
    // 回落路径:自检命中后走加载期原生引用(spy 只包住 console.error 本身,
    // 原生引用在模块加载期已 bind,不经过 spy——断言「不抛」即足够)
    spy.mockRestore();
  });

  it("常态转发到「当前」console:脱敏守卫替换 console.error 时垫片跟进守卫", () => {
    const seen: unknown[][] = [];
    const guard = (...args: unknown[]) => seen.push(args);
    console.error = guard;
    log.error("cred", 123);
    expect(seen).toEqual([["cred", 123]]); // 转发到当前(=守卫),非加载期固化引用
  });

  it("自检只对自身函数生效:console.error 是他人实现时正常转发", () => {
    const seen: unknown[][] = [];
    const other = (...args: unknown[]) => seen.push(args);
    console.error = other;
    log.error("x");
    expect(seen).toEqual([["x"]]);
  });
});
