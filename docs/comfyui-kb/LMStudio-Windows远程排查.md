# LM Studio Windows 远程服务排查(192.168.0.101:1234)

**适用**:漫影 qi21 [4013] AI扩写(MyQi21ApiPE)依赖的 Windows 侧 LM Studio 远程服务(9B 主力/本地 Mac 27B 兜底)。控制脚本=`apps/build/scripts/lmstudio-win-remote.sh`(status/load/start/doctor)。SSH=`zbj@192.168.0.101` 免密。

**本文来源**:2026-10-07 "服务假死"大翻案——服务从没死,真凶=程序级防火墙 Block 规则(详见第三节)。排查方法以下面两节为准。

## 一、30 秒快速分流(症状指纹)

从 Mac 执行(探活恒带 `--noproxy '*'`,防 Clash 截流局域网):

```bash
curl --noproxy '*' -sS -m 3 http://192.168.0.101:1234/lmstudio-greeting   # 服务应答?
ping -c 2 192.168.0.101                                                    # 主机在?
nc -vz -G 4 192.168.0.101 1234                                             # TCP 连通?
nc -vz -G 4 192.168.0.101 22 && nc -vz -G 4 192.168.0.101 3389             # 对照端口
```

| 指纹 | 定位 | 去向 |
|---|---|---|
| ping 不通 | Windows 没开/不在网 | 开机,别查软件 |
| ping 通 + 22/3389 通 + **唯 1234 超时(非拒绝)** | **程序级 Block 假死**(服务活着) | 卡点 4 |
| 1234 **秒拒(connection refused)** | 端口没人听,服务没起 | 卡点 1/2 |
| 拒绝且 netstat 只有 `127.0.0.1:1234` | 绑定错(只听本机) | 卡点 1 |
| REST 通 + 9B loaded 但出稿正文 0 字/透传 | 8k 窗饿死(loaded_ctx≠32768) | 第五节 |
| Windows 本机 curl 通 + Mac 不通 | 防火墙层;Mac 侧先排代理再定罪 | 卡点 3/4 + 坑清单 |

关键判据:**超时 ≠ 拒绝**。超时=包被丢(宿主/防火墙 drop);秒拒=包到了但没人听。根因完全不同,先分清再动手。

Windows 侧三验(下"服务挂了"结论前必过):

```bash
ssh -o BatchMode=yes zbj@192.168.0.101 "netstat -ano | findstr :1234"            # 0.0.0.0:1234 LISTENING?
ssh -o BatchMode=yes zbj@192.168.0.101 "curl -sS -m 4 http://127.0.0.1:1234/lmstudio-greeting"   # 本机自测
ssh -o BatchMode=yes zbj@192.168.0.101 "tasklist | findstr /i \"studio\""        # 进程在?
```

本机通 + 外部不通 ⇒ 防火墙层,服务无辜,直奔卡点 3/4。

## 二、四层卡点与修法(复发按此查)

1. **绑定**:LM Studio 默认只绑 127.0.0.1 → 官方路 `lms server start --bind 0.0.0.0`(手改 http-server-config.json 会被守护进程**覆写回**,勿走此路)
2. **守护进程随 SSH 会话死**:已建计划任务 `LMStudio-LAN-Server`(登入自启)——`ssh zbj@… 'schtasks /Run /TN "LMStudio-LAN-Server"'` 随时拉起
3. **防火墙画像/端口**:规则 `LMStudio-LAN-1234`(TCP 1234 入站,RemoteAddress=192.168.0.0/24,Profile=Any 已硬化,画像弹回 Public 不再影响)。确认:`Get-NetConnectionProfile`(WLAN 须 Private)+ `netsh advfirewall firewall show rule name="LMStudio-LAN-1234" verbose`
4. **程序级 Block 假死(1007 定谳)**:
   - 现象:外部 1234 全超时,但 ping/SSH/RDP 通、Windows 本机 curl 通、`0.0.0.0:1234 LISTENING`、模型满血 loaded——**服务从没死**
   - 根因:LM Studio **应用级 Block 规则**(Windows 授权弹窗被「取消/超时」时自动生成,Private 画像入站);防火墙 **Block>Allow 铁律**压过任何端口级放行规则,卡点 3 的规则形同虚设
   - 查(**端口级枚举查不到,必须按程序查**):
     ```powershell
     Get-NetFirewallApplicationFilter | Where-Object Program -like '*LM*Studio*' | Get-NetFirewallRule | Format-Table DisplayName,Action,Enabled,Direction,Profile
     ```
   - 修(可逆,`Enable-NetFirewallRule` 可还原):
     ```powershell
     Get-NetFirewallRule -DisplayName 'LM Studio' | Where-Object Action -eq 'Block' | Disable-NetFirewallRule
     ```
   - 预防:LM Studio(含更新版)首次监听弹 Windows 授权框时,勾「专用网络」并点「允许」——点取消=种下 Block 规则

## 三、1007 假死案卷(教训)

- 1006 晚"546s 马拉松生成带崩服务"结论**被推翻**:三发连续透传的 75s 超时指纹与今日全同,服务大概率一直活着,全是卡点 4 假象(75s=macOS 对被丢 SYN 的重试耗尽,不是服务死)
- 恢复"没成"也是误判:`schtasks /Run` 实际成功(任务返回 0、进程在跑),只是从 Mac 探活依旧被防火墙拦,看似无效
- **铁律:「服务挂了」必须过三验(端口监听/本机自测/外部分端口对照)才可下结论**;外部探不通≠服务死

## 四、坑清单

- `Get-NetFirewallRule -DisplayName x -Action y` 连用 = `AmbiguousParameterSet` 报错;先按 DisplayName 取全量再 `Where-Object Action -eq 'Block'` 过滤
- PowerShell over SSH 三层引号(zsh→cmd→PS):脚本块里的 `$_`/`$r` 过命令行必被吃掉,改用简化比较语法 `Where-Object Property -like 'value'`(零 `$`)
- Mac 探活恒带 `--noproxy '*'`;Clash TUN(198.18.x 虚拟网卡)在跑时,Mac 侧嫌疑用「nc 对照 22/3389」排除——22/3389 通而 1234 不通 ⇒ 问题在 Windows 防火墙,与 Mac 无关
- 脚本 `lmstudio-win-remote.sh` 的 doctor **四卡全查**(卡点 4=程序级 Block 枚举,1007 已合入:有启用中的 Block 规则会点名并给修复命令)
- 防火墙修复只 Disable 勿 Remove(留还原路);并行会话同时动防火墙时会互相踩(1007 实录:一分钟内四条规则被另一行动者整批禁用),动前先看规则现态

## 五、装载口径(服务活着 ≠ 能出正文)

- 9B 调优装载(Windows 侧):`lms load --gpu max --parallel 1 -c 32768 -y qwen3.5-9b-uncensored-hauhaucs-aggressive`
- TTL 1h 闲置自动卸载;重装**勿走 JIT**(默认 8192 窗 → qi21 教材下结构性饿死:输入+思考链吃光预算,正文 0 字)
- 验收:`/api/v0/models` 中 9B `state=loaded` 且 `loaded_ctx=32768`(从 Mac:`curl --noproxy '*' -sS http://192.168.0.101:1234/api/v0/models`)

### 思考链控制(1007 实弹定谳,raw 两轮+全链 A/B)

- **生效路:顶层 `reasoning_effort` 参数经 1234 转发生效**——`"none"`=硬关思考(模板预填空 `<think>` 块);**不发=模板默认 xhigh**(aggressive 模板 `reasoning_effort|default('xhigh')`)
- **实测量级(9B)**:小问句不发参数=124s/1803 思考 tok vs `none`=1s/0 tok;生产全链(教材+型底座+自检补发)`none`=39s 出 574 字/锚点 8/8;xhigh 全链**波动大**(思考量随机 ~1200-4600 tok/发:幸运浅思考 21s,1006 史 ~125-300s)——要确定性速度用关,要深度思考赌默认
- **无效路(勿再试)**:`chat_template_kwargs.enable_thinking:false` 被 LM Studio 层整个丢弃(52/52 无视);`/no_think` 文本尾被 aggressive finetune 无视;**`"low"` 档经 1234 无衰减**(两测 1565/1696 思考 tok)——直连 llama-server 内部口(1997,随装载漂移)曾见 low 简短思考,勿作常链
- 产线接法:[4013] MyQi21ApiPE「思考档位」下拉两档(**默认=关闭**/思考(xhigh);「低」无效已移除);手动验证=`lmstudio-win-remote.sh chat "…" 9b off`

## 六、看门狗(1007 立,常驻自愈)

Windows 计划任务 **LMStudio-Watchdog**(每 5 分钟,最高权限)跑 `%USERPROFILE%\.lmstudio\lmstudio-watchdog.ps1`,三查三救:

| 查 | 救 |
|---|---|
| ① 本机 127.0.0.1:1234 greeting 不通 | `schtasks /Run LMStudio-LAN-Server` 重拉服务(20s 后复验) |
| ② 无任何模型装载(TTL 闲置卸载后) | 调优装载 9B(gpu max/parallel 1/ctx 32768;**仅当全无装载才装**,27B 试验在用时不抢显存) |
| ③ 启用中的 LM Studio 程序级 Block 规则 | `Disable-NetFirewallRule`(卡点 4 假死自动清除) |

- 日志:`C:\Users\ZBJ\.lmstudio\watchdog.log`(每轮一行 tick,>100KB 自清);查:`ssh zbj@192.168.0.101 "powershell Get-Content $env:USERPROFILE\.lmstudio\watchdog.log -Tail 5"`
- 停用/移除:`schtasks /Change /TN LMStudio-Watchdog /DISABLE`(或 `/Delete /TN LMStudio-Watchdog /F`)
- **与产线档位互操作(2026-11-01 1101 自动化改版)**:看门狗**恒开**——video 档仅停「补装 9B」一救,由档位感知补丁承担(读 MODE 文件,见下节),其余三救恒活;手动切档 `win-line-switch.sh` 已于 1101 退役删除(备份在 `apps/output/line-mode-retired/`),档位由引擎侧 line_mode_server 自动切换;LM 治理忙时立即降级不强拆(D1),在途渲染由队列守卫保护。**看门狗 Disabled 在任何档位都是故障**(历史遗留 Disabled 用 `schtasks /Change /TN LMStudio-Watchdog /ENABLE` 恢复,部署脚本会自动核账)。
- 局限:计划任务跑在用户会话(与 LAN-Server 同约束),Windows 重启后未登入则两者都不跑;登入即恢复
- Mac/节点侧配套(同日落地):[4013] MyQi21ApiPE 发前 3s 探活+无代理 opener+透传时 ui 状态字段 `api_pe_status`(JS 把节点标红+标题警示)——Windows 真死时产线 3 秒切本地 27B 不死等,画布一眼可辨透传

---

## 产线档位自动切换(2026-11-01,1101 自动化改版)

- **引擎身份事实与 actor 通道选型(D3)**:质询轮实查引擎曾以 SYSTEM 跑(pid 25032);1101 施工轮实查当前引擎由漫影 App 托管(`manying-studio.exe` 父进程,owner=ZBJ\ZBJ)——身份随部署形态漂移,故 LM 治理通路定为 actor 模式:引擎只发指令(原子写 `C:\Users\ZBJ\.lmstudio\line-mode-action.json` → `schtasks /Run MY-LineMode-actor` → 轮询 `line-mode-result.json`),执行件以 **ZBJ + S4U**(Service for User,无密码、不要求交互登入)计划任务跑,解无人登入触发;**attempt_id 握手协议**防旧 result 串话(每次发指令生成新 uuid,只认当前 id 的回读)。
- **lms.exe 用户级安装与 actor 部署件**:`C:\Users\ZBJ\.lmstudio\bin\lms.exe`(引擎侧 LMS_ENV 注入表把 USERPROFILE/APPDATA/LOCALAPPDATA 指向 ZBJ);部署件=`apps/build/scripts/win/line-mode-actor.ps1`(部署位 `C:\Users\ZBJ\.lmstudio\`)+计划任务 `MY-LineMode-actor`+部署脚本 `apps/build/scripts/win/line-mode-actor-deploy.py`(Mac 上跑,持 win-control-lock L2;备份原 GBK 看门狗为 `.bak-<date>`、S4U 注册需提升会话——未提升打印手动指引退出非零、看门狗 ENABLE 核账、actor 只读自检全链;幂等可重跑)。
- **看门狗 ps1 档位感知语义(F8,评审#4/#6 加修 mode+state 连判)**:救②补装 9B 前读 `C:\Users\ZBJ\.win-line-mode.json`——`mode=video`(任何 state)跳过补装;`mode=image` 且 state∈{active,legacy,无state}→照常补装;`mode=image` 且 state∈{switching,degraded,failed,none}→**跳过+日志**(切换器序列/自愈进行中,此刻补装会绕过队列守卫在 H3 在途时抢显存、并与切换器经 actor 的 load9b 并发产生 :2 重复实例);**解析失败/文件损坏/mode 字段缺失同样保守跳过+告警(无自动回退)**;文件不存在=未部署/初始态→原生补装照旧。其余三救恒活。
- **GET /my-nodes/line-mode 限源**:只应引擎本机环回(127.0.0.1/::1,其余 403)——远程查询须经 **ssh 隧道**(如 `ssh -L 17001:127.0.0.1:<引擎口>` 后 curl 本地);App 层展示若要直连,留待展示役放宽预案,本轮不开。
- **D1 降级语义与自愈闭环(评审#1 修)**:LM 忙(status≠idle)时切换器**立即降级零等待**——目标档位即刻到手(state=degraded,degraded_steps=[lm]+告警),LM 生成不被打断;后续同档提交在 ≤5min 限频窗外触发**轻探测**(LM 形态已被外部修好→零动作覆写 active)或**补跑治理序列**(补全被推迟的 lm/free 步)→active。队列守卫(在途渲染红线)超时 15min 同样降级——那是红线不是 LM busy。
- **/free 语义(评审#9 修)**:引擎 /free 是**全局**清模型缓存(unload_models+free_memory 无选择性),两向档位切换共用;发送前**等引擎队列完全空**(触发提交自身渲染完成后)才执行,永不落在途渲染中辙——队列 15min 不空则 free 步降级留告警等自愈补跑。
- **D5 任务边界与防乒乓(用户拍板)**:lms unload/load 动作同样仅引擎队列**完全空**时执行(替代初版方向性守卫——完全空蕴含无对向,触发提交同向任务也须跑完才动机器);反向切换最小驻留 5 分钟(MODE.switched_at 距今 <300s 的到位态反向请求拒切分毫不动,failed 态不拦)。
- **D6 worker 首任务等待(用户拍板)**:put 永不阻塞;worker(PromptQueue.get)取任务遇目标档切换中→等待完成上限 120s(每个切换窗口只等首任务一次,窗口结束复位;超时放行+`[D6]` 告警日志)。注:触发切换的首提交会让切换器(lm 步等队列空)与 worker(等切换完)互等,由 120s 超时打破——拍板接受的固定语义。
- **D7 人机互斥(用户拍板)**:切换器机器动作段(watchdog/load9b/unload,经 actor 发出时)复用 win-control 锁文件 `C:\Users\ZBJ\.win-control.json` 短临界区互斥(同 `.guard` 字节锁原语,owner=line-mode-server-*,L1/TTL 8min;等锁 60s 超时→"guard" 步降级);**持锁会话装模型/动显存前应先查 GET /my-nodes/line-mode**(CLAUDE.md 协议第 2 条已补)。
- **急停开关**:创建标记文件 `C:\Users\ZBJ\.win-line-mode.disabled` → 切换器每序列前复查即 no-op(观察模式仍在,出图不受影响);撤销=删除该文件。
- **残存竞态窗口已知代价**:卸载步(≤120s)/装载步(≤300s)窗口内对向提交,守卫复查只能收窄不能归零——装载窗口内再提交视频可能撞 OOM,实弹 G5b 记录残窗频率入验收报告。
