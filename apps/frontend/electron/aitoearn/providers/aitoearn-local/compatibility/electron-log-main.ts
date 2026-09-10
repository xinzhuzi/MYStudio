/* eslint-disable no-console -- 电子日志兼容层:转发到「当前」console 方法 */
// 09-10 P1:不得在模块加载期 bind 固定 console 引用——凭据脱敏守卫
// (platform-bridge withCredentialRedaction)运行时替换 console.log,
// 先于守卫绑定的原函数引用永远绕过脱敏。
const log = {
  transports: { file: { level: "info", maxSize: 10 * 1024 * 1024, resolvePathFn: undefined as (() => string) | undefined } },
  initialize() {},
  log: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
};

export default log;
