/**
 * my_scope.js — ComfyUI 前端扩展的作用域生命周期工具(1018 吸收自
 * pixixai/ComfyUI-AlignLayout runtime.js 的**方法重实现**;上游无 LICENSE
 * 文件,零逐字拷贝,吸收四律=登记/逆序回收/失败隔离/全局占用恢复)。
 *
 * 解决:扩展挂监听/定时器/window 全局后无统一拆卸——画布重载/前端模式切换/
 * 热重载=监听泄漏与全局污染(我仓 my_nodes web JS 现直挂无 teardown)。
 *
 * 用法(断言面见 tests/my_scope_probe_1018.mjs):
 *   const scope = MyScope.create();
 *   scope.listen(window, "keydown", fn);   // dispose 自动 removeEventListener
 *   scope.expose("MY_X", obj);             // dispose 自动还原旧值/删除新键
 *   scope.timeout(fn, 100);                // dispose 自动 clearTimeout
 *   scope.add(cleanup);                    // 任意清理函数,逆序执行
 *   scope.dispose();                       // 幂等;单条清理失败不拖累其余
 *   // 双前端模式热切换(default/nodes2 同款思路):
 *   const ctl = MyScope.createModeController(buildDefault, buildNodes2);
 *   await ctl.switchMode(isNodes2);        // 旧 scope 全收→新 scope 逐件 setup
 *                                          // (setup 中途被切走即停;抛错=全收+态复位)
 */
(function (globalThisRef) {
    "use strict";

    function create() {
        const cleanups = [];
        const timers = new Set();
        const scope = {
            active: true,
            add: function (cleanup) {
                if (typeof cleanup !== "function") return;
                if (scope.active) {
                    cleanups.push(cleanup);
                } else {
                    cleanup(); // 已死 scope 再挂=立即执行防漏
                }
            },
            listen: function (target, type, listener, options) {
                target.addEventListener(type, listener, options);
                scope.add(function () {
                    target.removeEventListener(type, listener, options);
                });
            },
            expose: function (name, value) {
                const existed = Object.prototype.hasOwnProperty.call(globalThisRef, name);
                const previous = globalThisRef[name];
                globalThisRef[name] = value;
                scope.add(function () {
                    if (existed) {
                        globalThisRef[name] = previous;
                    } else {
                        delete globalThisRef[name];
                    }
                });
            },
            timeout: function (callback, delay) {
                if (!scope.active) return null;
                const id = globalThisRef.setTimeout(function () {
                    timers.delete(id);
                    if (scope.active) callback();
                }, delay);
                timers.add(id);
                return id;
            },
            dispose: function () {
                if (!scope.active) return;
                scope.active = false;
                timers.forEach(function (id) { globalThisRef.clearTimeout(id); });
                timers.clear();
                for (let i = cleanups.length - 1; i >= 0; i--) {
                    try {
                        cleanups[i]();
                    } catch (e) {
                        console.error("[my-scope] 清理失败(已隔离):", e);
                    }
                }
                cleanups.length = 0;
            }
        };
        return scope;
    }

    function createModeController(buildDefault, buildNodes2) {
        let activeScope = null;
        let activeMode = null;
        return {
            switchMode: async function (useNodes2) {
                if (activeMode === useNodes2 && activeScope && activeScope.active) return;
                if (activeScope) activeScope.dispose();
                const scope = create();
                activeScope = scope;
                activeMode = useNodes2;
                try {
                    const features = (useNodes2 ? buildNodes2 : buildDefault)(scope);
                    for (const feature of features) {
                        await feature.setup();
                        if (!scope.active) return; // setup 中途被切走即停
                    }
                } catch (e) {
                    scope.dispose();
                    if (activeScope === scope) {
                        activeScope = null;
                        activeMode = null;
                    }
                    throw e;
                }
            },
            dispose: function () {
                if (activeScope) activeScope.dispose();
                activeScope = null;
                activeMode = null;
            }
        };
    }

    const MyScope = { create: create, createModeController: createModeController };
    globalThisRef.MyScope = MyScope;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = MyScope; // node 侧探针可 require
    }
})(typeof window !== "undefined" ? window : globalThis);
