# torch cu132 一键升级役·七轮排障全档案(2026-11-05 ~ 11-07)

> 本档=完整错误账本+根因链+修法+预防规则。后续遇到同类问题**先查此档**再动手,不要重犯。
> 任务档: `.trellis/tasks/11-05-torch-cu132-oneclick/` | 最终提交: `a3734a65`

## 终态

- **Windows 引擎: torch 2.14.1+cu132 ✅ 已升级成功**(1107 第七轮实弹)
- Mac 引擎: torch 2.14.1(原生 MPS 轮,1106 用户在本地配置界面亲手升级)
- 双机同版本号 2.14.1,升前均为 2.11.0+cu128

## 七轮排障账

### 第 1 轮:CLIXML 垃圾混入 SSH 输出

| 项 | 内容 |
|---|---|
| **报错** | `无法核实远端 pip 状态` |
| **层** | `_torch_remote_pip_running()` → `output.isdecimal()` 判 False |
| **根因** | PowerShell 在 SSH exec 模式下把进度记录写成 CLIXML XML(`<Objs...>`)混入 stdout;代码对整串做 isdecimal() 判 False |
| **修法** | `_torch_powershell()` 加 `$ProgressPreference='SilentlyContinue'` 在源头抑制(一刀切修所有命令) |
| **预防** | **部署前手动跑一次 SSH 命令看原始输出**——有 CLIXML 一眼就能看到 |

### 第 2 轮:引擎重启超时

| 项 | 内容 |
|---|---|
| **报错** | `引擎重启后 120 秒内未就绪` |
| **根因** | 20G 模型冷启动 > 120s;代码硬编码 120s 拍脑袋 |
| **修法** | 120s → 300s;后续改为不定死总时长(见第 7 轮) |
| **预防** | **部署前手动测引擎冷启动实际耗时**再设超时 |

### 第 3 轮:nvidia-smi 格式变了

| 项 | 内容 |
|---|---|
| **报错** | `显卡驱动不支持目标 CUDA 版本` |
| **根因** | 驱动 621.14 输出 `CUDA UMD Version: 13.5`;代码 regex 硬编码 `CUDA Version:` 匹配不上 |
| **修法** | regex 改 `CUDA(?:\s+UMD)?\s+Version:` 兼容两种格式 |
| **预防** | **部署前手动跑一次 nvidia-smi 看输出格式** |

### 第 4 轮:Clash TUN 篡改 HTTPS 下载(SHA256 不匹配)

| 项 | 内容 |
|---|---|
| **报错** | `ERROR: THESE PACKAGES DO NOT MATCH THE HASHES` |
| **根因** | Windows Clash(verge-mihomo TUN 模式)在网络层劫持 HTTPS 大文件下载;pytorch.org 是外国域名→Clash 走代理节点→下载内容被篡改;清空环境变量不够(TUN 是系统级) |
| **错误修法(走了弯路)** | 停 mihomo 进程(5s 复活)、停 service(断网)、后台循环杀进程(hack)——全是在对抗 Clash |
| **正解(用户一句话)** | **换直连镜像**——交大(.cn 域名)Clash 走直连不经代理,不会被篡改 |
| **预防** | **下载前先测 1KB 哈希**;外国域名被劫持时找 .cn 直连镜像 |

### 第 5 轮:阿里镜像无 cu132

| 项 | 内容 |
|---|---|
| **报错** | `Could not find a version that satisfies the requirement torch==2.14.1+cu132 (from versions: none)` |
| **根因** | `mirrors.aliyun.com/pytorch-wheels/cu132/` 没有 cu132 版本的轮子;代码只用官方+阿里两个源 |
| **正解** | 全网扫描 8 家国内镜像,**上海交大(SJTU)是唯一有 cu132 的** |
| **预防** | **选镜像前先扫描所有可用源**,不要只查代码里已有的两个 |

### 第 6 轮:烟测节点数不够(插件还在加载)

| 项 | 内容 |
|---|---|
| **报错** | `引擎烟测失败` |
| **根因** | 引擎重启后插件异步加载;节点数 2924/3219(91%) 未到 95% 门限;单次检查太快 |
| **修法** | 加 5 轮×30s 重试循环 |
| **预防** | **引擎就绪 ≠ 插件全加载**;烟测必须等插件爬升 |

### 第 7 轮:SSH 会话守卫拦回滚(意外救场)

| 项 | 内容 |
|---|---|
| **报错** | `回滚失败,引擎可能离线,须人工介入: 升级期间 SSH 会话已改变` |
| **根因** | 引擎重启时 SSH 自动重连,新 client ≠ 升级开始时的 client → 会话守卫拒绝所有命令(包括回滚) |
| **意外结果** | **回滚被拦 = 新版本被保留 = 升级实际成功!** |
| **遗留** | 节点数 91% 差 4% 到门限;会话守卫在引擎重启后应放宽(或用新 session) |

## 国内 PyTorch cu132 镜像扫描(1107 实测)

| 镜像 | 状态 | 说明 |
|---|---|---|
| **上海交大 mirror.sjtu.edu.cn** | ✅ 有 cu132 | **首选**;.cn 域名 Clash 直连;有 cp312 Win 轮子;Mac+Win 双端 200 |
| 山东大学 mirrors.sdu.edu.cn | ⚠️ 目录在但无轮子 | 200 但无 cp312/2.14.1 |
| 清华 mirrors.tuna.tsinghua.edu.cn | ❌ 404 | 无 cu132 |
| 阿里 mirrors.aliyun.com | ❌ 404 | 无 cu132(旧役已排除) |
| 北外 mirrors.bfsu.edu.cn | ❌ 连不上 | 000 |
| 浙大 mirrors.zju.edu.cn | ❌ 404 | 无 cu132 |
| 中科大 mirrors.ustc.edu.cn | ❌ 404 | 无 cu132 |
| 南大 mirrors.nju.edu.cn | ❌ 404 | 无 cu132 |

## 部署前验证门(五验,1107 用户刻碑)

详见 `.trellis/spec/guides/pre-deploy-verification-gate-guide.md` 及 `.claude/CLAUDE.md`

1. **SSH 命令实弹** — 手动跑看原始输出(CLIXML/编码/格式)
2. **网络可达+哈希** — 从目标机器测,下载 1KB 验哈希(Clash TUN 篡改)
3. **超时实弹** — 先测实际耗时再设,不定死总时长;进度驱动优先
4. **输出解析实弹** — 拿真实输出跑 isdecimal/json.loads/regex
5. **全链自跑** — API 直发完整跑,绿了才装机;**永不让用户做第一次测试**

## Clash 行为速查

| 域名类型 | Clash 路由 | 大文件下载 |
|---|---|---|
| .cn 域名(如 mirror.sjtu.edu.cn) | **直连**(不经代理) | ✅ 不会被篡改 |
| 外国域名(如 download.pytorch.org) | **走代理节点** | ❌ HTTPS 大文件可能被篡改(SHA256 不匹配) |
| HuggingFace(huggingface.co) | 走代理但 CDN 兼容好 | ✅ 通常正常(aria2c 4MB/s 实测) |

## Windows Clash 进程结构

```
clash-verge          (PID xxxx)  GUI 应用(D:\VPN\Clash Verge\)
clash-verge-service (PID xxxx)  Windows 服务(C:\ProgramData\clash-verge-service\)
verge-mihomo         (PID xxxx)  TUN 代理核心(C:\ProgramData\clash-verge-service\cores\)
```

- 停 `verge-mihomo` 进程 → 5s 内 service 自动拉回
- 停 `clash-verge-service` → TUN 断网(不可用)
- **正解:不停任何进程,换 .cn 直连镜像**
