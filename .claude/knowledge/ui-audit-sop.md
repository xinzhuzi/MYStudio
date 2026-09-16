# UI 截图审计 SOP(保温会话)

> 09-15 用户「根治提速」裁定产物。**任何对漫影应用做截图/UI 审计的会话,动手前先读本页。**
> 标准工具:`apps/build/scripts/cdp-ui-audit-shot.mjs`(阶段计时 + 冷启兜底 + 保温附着 + 多状态连拍)。

## 铁律

1. **禁止每轮 pkill 冷启动**。杀进程→重启→等就绪是最贵路径(旧链路分钟级,上限 300s+720s),不许进审计循环的固定路径。
2. **一次启动,多状态连拍**:一条命令 `--shots first-screen,local-models,comfy-canvas` 连续出图,冷启动成本只付一次。
3. **要干净状态用 `--reload`**(CDP Page.reload),不杀进程;只有改了主进程代码才真正重启。
4. **非引擎页面不等引擎**:只有 `comfy-canvas`(等 webview)是引擎门;审计首屏/本地模型页等直接截,勿加引擎等待。
5. **改 ComfyUI web 资产看效果走 rsync 到引擎家 + 刷新 webview**,不整链打包;生效路径权威 = `docs/comfyui-kb/定制代码地图.md`。用户明说「打包/覆盖安装」时仍必须走 `apps/build/packaging/build-mac.sh` 全链(AGENTS.md 铁律,本 SOP 不豁免)。
6. 脚本自带**防打断守卫**:应用在运行但 CDP 不可达(=用户正常使用中)会中止;确需重启实例加 `--force-relaunch`。

## 用法

```bash
# 常规:一条命令连拍多状态(冷启兜底自动处理)
node apps/build/scripts/cdp-ui-audit-shot.mjs --shots first-screen,local-models

# 自定义状态:导航与就绪都是 JS 表达式
node apps/build/scripts/cdp-ui-audit-shot.mjs --shots custom \
  --nav '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="存储")?.click()' \
  --ready '!!document.querySelector("[data-storage-panel]")'

# 收摊:截完退出应用
node apps/build/scripts/cdp-ui-audit-shot.mjs --shots first-screen --quit
```

输出:`/tmp/ui-audit/<时间戳>-<状态名>.png`(默认 sips 缩到 1200px,`--resize 0` 关闭);每行 `[耗时]` 阶段计时;console error/warning 自动捕获打印尾部。CDP 截图失败自动回落 `screencapture -x`。

## 实测基准(2026-09-15,本机)

| 路径 | 耗时 |
|------|------|
| 冷启动→首屏截图(应用 CDP 页 ~3s 出现) | **4.5s** |
| 保温附着→截图 | **1.4s** |
| 旧链路(pkill+等引擎+固定 sleep 12s) | 1.5~3min,坏情况十几分钟 |

## 环境真相(坑)

- **沙箱/命令回收**:agent 沙箱里 spawn 的应用在**命令结束时会被进程树回收**。跨命令保温两种解法:
  ① 后台任务保活:`run_in_background` 跑 `node cdp-ui-audit-shot.mjs --shots first-screen && sleep 300`,随后前台命令即可 warm attach;② 终端/用户手动起应用。
- **GPU 负载 ≥6 时新起 Electron 会被 SIGTERM**(非代码问题):等负载 <6 重跑即绿,勿误诊为脚本故障。
- 引擎门(comfy-canvas)等待慢是正常(引擎冷启 1~3min);脚本 1s 轮询 + 上限 720s + 期间自动点 `[data-comfy-canvas-start]`。
- 审计前提:装机版应用在 `/Applications/漫影工作室.app`;CDP 端口默认 9222(`--port` 可改)。
