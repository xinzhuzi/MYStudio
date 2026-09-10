/* eslint-disable no-console -- 电子日志兼容层:转发到「当前」console 方法 */
// 09-10 P1:不得在模块加载期 bind 固定 console 引用——凭据脱敏守卫
// (platform-bridge withCredentialRedaction)运行时替换 console.log,
// 先于守卫绑定的原函数引用永远绕过脱敏。
//
// 09-10 P0 崩溃根修(vendor 装载自递归):vendor log.ts 在模块加载时执行
// `console.error = log.error`。若本垫片无自检,console.error 将变成
// 「调用 console.error 自身」的函数→主进程首次 console.error 即爆栈
// (装机实弹 RangeError: Maximum call stack size exceeded)。
// 处置:转发目标若恰是本垫片函数(=我们已被装上 console),回落到加载期
// 捕获的原生实现——该状态下脱敏守卫必然不在窗口内(console 被我们占着,
// 守卫的临时包装早已 finally 还原),故回落不构成脱敏绕过。
const nativeConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
};

const forwardLog = (...args: unknown[]): void => {
  const current = console.log;
  if (current === forwardLog) nativeConsole.log(...args);
  else current(...args);
};

const forwardError = (...args: unknown[]): void => {
  const current = console.error;
  if (current === forwardError) nativeConsole.error(...args);
  else current(...args);
};

const log = {
  transports: { file: { level: "info", maxSize: 10 * 1024 * 1024, resolvePathFn: undefined as (() => string) | undefined } },
  initialize() {},
  log: forwardLog,
  error: forwardError,
};

export default log;
