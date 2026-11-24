/**
 * SSH 远端连接域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):
 * 多条连接列表/切换/探活/令牌刷新/隧道开关/远端 MYStudio 拉起与关闭。逻辑零改动。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSshPresetsStore, type SshPreset } from "@/stores/settings/ssh-presets-store";
import {
  getComfySshStatus,
  setComfySshConfig,
  testComfySshConnection,
  refreshComfySshToken,
  launchRemoteMystudio,
  shutdownRemoteMystudio,
  SIDECAR_DOWN_GUIDANCE,
  isSidecarDownError,
  type ComfySshStatus,
  type ComfySshTestReply,
} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import { toast } from "sonner";
import { emptySshFormDraft, resolveActiveSshPresetId, sshDraftToInput, type SshFormDraft } from "./McpSettingsParts";

export function useSshAdmin() {
  // ── SSH 远端连接(11-03 终版:多条连接列表,引擎/SSH 两列表零联动)──
  const [sshStatus, setSshStatus] = useState<ComfySshStatus | null>(null);
  const [mystudioAction, setMystudioAction] = useState<"idle" | "launching" | "shutting">("idle");
  const [shutdownConfirmOpen, setShutdownConfirmOpen] = useState(false);
  const mystudioActionRef = useRef(false);
  // 隧道开关=全局单份(不随条目;status 回显,切换连接/拨开关时随凭据落章)
  const [sshTunnelEnabled, setSshTunnelEnabled] = useState(true);
  const [sshSwitching, setSshSwitching] = useState(false);
  const [sshTesting, setSshTesting] = useState(false);
  const [sshRefreshing, setSshRefreshing] = useState(false);
  const [sshTest, setSshTest] = useState<
    | { status: "idle" }
    | { status: "ok"; reply: ComfySshTestReply }
    | { status: "error"; message: string }
  >({ status: "idle" });
  // 「立即刷新令牌」结果行(null=未操作;ok 决定着色)
  const [sshTokenMsg, setSshTokenMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  // 添加表单(展开态)+编辑 dialog(1103 终版 R2:form→list 范式迁移,照引擎区)
  const [addingSsh, setAddingSsh] = useState(false);
  const [sshAddDraft, setSshAddDraft] =
    useState<SshFormDraft>(emptySshFormDraft);
  const [sshEditing, setSshEditing] = useState<SshPreset | null>(null);
  const [sshEditDraft, setSshEditDraft] =
    useState<SshFormDraft>(emptySshFormDraft);
  // ── SSH 远端连接(1103 终版):切换连接/测试连接(仅探活)/立即刷新令牌 ──
  // 1103 追修(保存即显"断开"假断,保留项):切换触发的 keeper 重连有 1-2s 撕旧
  // 建新窗口,单次状态回读会吃到处断开态且永不再刷——带退避沉降轮询直到连上或
  // 试尽。
  // (1104 engine-sync R4:旧「同步插件」行内按钮+handleSyncPlugins 已撤,换引擎
  // 地址区「引擎同步」折叠子区;后端 /comfy/ssh/sync-plugins 端点保留兼容。)

  const sshActiveFingerprint = useSshPresetsStore((s) => s.activeFingerprint);
  // SSH 状态回显(1103 终版 Q1 指纹真源):sidecar 未运行/老 sidecar 无 SSH 路由
  // (404 同族)时静默空态——照远程引擎行范式,首开设置页不弹错。status 只带
  // host/user/tunnelEnabled(port/keyPath 后端契约不回显;port 侧匹配事实住
  // store.activeFingerprint,见 resolveActiveSshPresetId)。同一拍做存量迁移
  // (Q2):store 空+后端已配置 → ssh-remote.json 现连自动入列为第一条
  // (label=host,port 走默认 22,status 不回显;真 port 点行落章后由回执扶正);
  // GET 失败=静默跳过(C6)。
  useEffect(() => {
    let cancelled = false;
    getComfySshStatus()
      .then((status) => {
        if (cancelled) return;
        setSshStatus(status);
        // 首拍入迁移基线(下方轮询 effect 沿此判断断开/回连)
        sshPrevConnectedRef.current = status.connected;
        // ?? 兜底:老 sidecar/异常回执缺键时不把 undefined 写进开关
        // (Switch checked 失控告警防线)
        setSshTunnelEnabled(status.tunnelEnabled ?? true);
        if (
          status.configured &&
          status.host &&
          useSshPresetsStore.getState().presets.length === 0
        ) {
          useSshPresetsStore.getState().save({
            host: status.host,
            user: status.user ?? "",
            label: status.host,
          });
        }
      })
      .catch(() => {
        /* 保持空态,操作时会给出大白话;迁移一并跳过(C6) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // SSH 断开/回连迁移基线(1114 修:mount 首拍写入,轮询 effect 沿此 toast)
  const sshPrevConnectedRef = useRef<boolean | null>(null);
  // 1114 修:SSH 徽章此前只在挂载取一拍——keeper 断线自愈后面板停在旧「断开×」
  // 红字(用户实弹:Errno 54 早已重连,截图仍红)。轻轮询(照 torch-info 10s 同
  // 拍)保新鲜;断开/回连两向迁移各 toast 一声(首拍 null 基线不弹,防开页即
  // 噪)。仅设置页在位时监控;全局常驻监控是另一档事,不在本修范围。
  useEffect(() => {
    const tick = async () => {
      try {
        const status = await getComfySshStatus();
        setSshStatus(status);
        const prev = sshPrevConnectedRef.current;
        sshPrevConnectedRef.current = status.connected;
        if (prev === true && status.connected === false) {
          toast.error(`SSH 断开:${status.lastError || "连接已断开"}`);
        } else if (prev === false && status.connected === true) {
          toast.success("SSH 已重连 ✓");
        }
      } catch {
        /* 轮询失败静默:sidecar 未起/瞬态,下拍再试 */
      }
    };
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const runMystudioAction = async (action: "launching" | "shutting") => {
    if (mystudioActionRef.current) return;
    if (!sshStatus?.connected) {
      toast.error("SSH 未连接——先在列表点一条连接");
      return;
    }
    mystudioActionRef.current = true;
    setMystudioAction(action);
    try {
      const reply = await (action === "launching" ? launchRemoteMystudio() : shutdownRemoteMystudio());
      if (!reply.ok) toast.error(reply.output || "远端操作失败");
      else if (action === "shutting") toast.success("已关闭 MYStudio(App+引擎)");
      else if (reply.alreadyRunning && !reply.engineReady && !reply.engineRestarted)
        toast.error(`MYStudio 已在运行,未重拉；引擎补拉失败: ${reply.output || "schtasks 未成功"}`);
      else if (reply.alreadyRunning)
        toast.success(`MYStudio 已在运行,未重拉${reply.engineRestarted ? "(引擎已补拉)" : ""}`);
      else toast.success("已拉起 MYStudio(引擎启动中,稍后即可连)");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远端操作失败");
    } finally {
      mystudioActionRef.current = false;
      setMystudioAction("idle");
    }
  };
  const refreshSshStatusWithSettle = async (maxAttempts = 4) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await getComfySshStatus();
        setSshStatus(status);
        if (status.connected) return;
      } catch {
        /* 回读失败保留上次态,下轮再试 */
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, attempt === 0 ? 1500 : 3000),
        );
      }
    }
  };

  // 切换当前 SSH 连接(点行,R2):POST /comfy/ssh/config 写该条凭据(隧道随行,
  // 全局开关态一并落章)→keeper 重连→沉降轮询翻绿→LRU 置顶。后端 ssh-remote.json
  // 恒单份=当前连接(一时刻一连接,R4 契约零改)。回执(save_config 返回完整落盘
  // 配置,含 port)存为当前连接指纹(③修复:同 host+user 异 port 双档的匹配消歧
  // 靠它,持久化跨重开存活)。
  const switchSshConnection = async (preset: SshPreset) => {
    setSshSwitching(true);
    setSshTest({ status: "idle" });
    try {
      const reply = await setComfySshConfig({
        host: preset.host,
        port: preset.port,
        user: preset.user,
        keyPath: preset.keyPath,
        tunnelEnabled: sshTunnelEnabled,
        password: preset.password || "",
      });
      useSshPresetsStore.getState().setActiveFingerprint({
        host: reply.host,
        port: reply.port,
        user: reply.user,
      });
      toast.success(`SSH 已切换:${preset.label}`);
      useSshPresetsStore.getState().touch(preset.id);
      // 切换后刷新实时态=沉降轮询(单次回读会吃 keeper 重连窗口的假断态,1103 追修)
      void refreshSshStatusWithSettle();
    } catch (error) {
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : error instanceof Error
          ? error.message
          : "切换失败";
      setSshTest({ status: "error", message });
      toast.error(message);
    } finally {
      setSshSwitching(false);
    }
  };

  // 添加表单保存(R2):只入 store 不落章——激活走点行(与引擎设备「保存并生效」
  // 区分:SSH 列表保存=存意图,零副作用)。host 空=store 拒收,这里给文案。
  const submitAddSsh = () => {
    const saved = useSshPresetsStore
      .getState()
      .save(sshDraftToInput(sshAddDraft));
    if (!saved) {
      setSshTest({
        status: "error",
        message: "SSH 主机必填(如 192.168.0.101)",
      });
      return;
    }
    setAddingSsh(false);
    setSshAddDraft(emptySshFormDraft);
    setSshTest({ status: "idle" });
    toast.success(`SSH 连接「${saved.label}」已保存,点击该行即可连接`);
  };

  // 编辑 dialog 保存(R2:改所有字段,保 id):只改 store 档案;若改的正是当前
  // 连接行,后端仍持旧凭据——点该行重新落章即生效(toast 指路,不偷写)。
  const submitEditSsh = () => {
    if (!sshEditing) return;
    const saved = useSshPresetsStore
      .getState()
      .save(sshDraftToInput(sshEditDraft, sshEditing.id));
    if (!saved) {
      toast.error("SSH 主机必填(如 192.168.0.101)");
      return;
    }
    setSshEditing(null);
    toast.success(`SSH 连接「${saved.label}」已更新,点该行应用新凭据`);
  };

  // 隧道开关(全局,保留现位置):翻转即写回当前连接(resolveActiveSshPresetId
  // 消歧后的那一条携全量凭据落章——同 host+user 异 port 双档时恒取 UI 标
  // 「当前连接」的那行,不冒认;防 status 无 keyPath 回显被空值覆写);无当前
  // 连接/无法消歧=只翻本地态,随下次点行激活落章。
  const toggleSshTunnel = async (checked: boolean) => {
    setSshTunnelEnabled(checked);
    const presets = useSshPresetsStore.getState().presets;
    const activePreset = presets.find(
      (p) =>
        p.id ===
        resolveActiveSshPresetId(presets, sshStatus, sshActiveFingerprint),
    );
    if (!activePreset) return;
    try {
      const reply = await setComfySshConfig({
        host: activePreset.host,
        port: activePreset.port,
        user: activePreset.user,
        keyPath: activePreset.keyPath,
        tunnelEnabled: checked,
      });
      useSshPresetsStore.getState().setActiveFingerprint({
        host: reply.host,
        port: reply.port,
        user: reply.user,
      });
      void refreshSshStatusWithSettle();
    } catch {
      /* 写回失败保本地态(下次点行激活随行),不给打断性报错 */
    }
  };

  // 测试连接(POST /comfy/ssh/test,仅测不存;后端契约=测当前连接,行内/表单
  // 钮共用):回执四件——登录用户/服务器版本(SSHServer banner)/令牌读取结果
  // (len 掩码,内容永不回显)/隧道探活。失败态带 reason(needs-runtime/
  // not-configured/disconnected)+message。
  const testSshConnection = async () => {
    setSshTesting(true);
    setSshTest({ status: "idle" });
    try {
      const reply = await testComfySshConnection();
      setSshTest({ status: "ok", reply });
      // 1114 修:失败回执此前只落区块底部结果框(离行内按钮隔一张隧道卡,用户
      // 实弹「没提示」)——失败加 toast 即时反馈,底部结果框保留=双呈现
      if (!reply.ok) {
        toast.error(
          reply.message || `测试失败(${reply.reason ?? "未知原因"})`,
        );
      }
    } catch (error) {
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : error instanceof Error
          ? error.message
          : "测试失败";
      setSshTest({ status: "error", message });
      toast.error(message);
    } finally {
      setSshTesting(false);
    }
  };

  // 立即刷新令牌(POST /comfy/ssh/token-refresh):SFTP 自动重取远端
  // controlToken(R2 病根根治的手动触发点);回执 ok+tokenRefreshedAt(epoch 秒)。
  const refreshSshTokenNow = async () => {
    setSshRefreshing(true);
    setSshTokenMsg(null);
    try {
      const reply = await refreshComfySshToken();
      if (reply.ok) {
        const at =
          typeof reply.tokenRefreshedAt === "number"
            ? reply.tokenRefreshedAt
            : null;
        setSshTokenMsg({
          ok: true,
          text: `令牌已刷新${at ? `(${new Date(at * 1000).toLocaleTimeString()})` : ""}`,
        });
      } else {
        setSshTokenMsg({
          ok: false,
          text: "令牌刷新失败(SSH 未连接,或令牌真源路径均未取到有效令牌)——可先「测试连接」看四项回执定位",
        });
      }
    } catch (error) {
      setSshTokenMsg({
        ok: false,
        text: isSidecarDownError(error)
          ? SIDECAR_DOWN_GUIDANCE
          : error instanceof Error
            ? error.message
            : "刷新失败",
      });
    } finally {
      setSshRefreshing(false);
    }
  };

  // needs-runtime(C2 终版:SSH 列表区顶部全局黄条,环境级不随条目):
  // status.available=false(paramiko 未装)或测试回执点名 needs-runtime——提示去
  // Python 运行环境页;实时态仍按连接态展示(fail-open 不拦操作)。
  const sshNeedsRuntime =
    sshStatus?.available === false ||
    (sshTest.status === "ok" && sshTest.reply.reason === "needs-runtime");
  // ── SSH 连接条目(1103 终版:独立多条 store,与引擎列表零联动)──
  const sshPresets = useSshPresetsStore((s) => s.presets);
  // 当前连接指纹(1103 ③修复):落章回执记住的 host+port+user,随 store 持久化;
  // 与 sshStatus(host/user 实时真源)合力做 host+port+user 三全比对(见
  // resolveActiveSshPresetId),同 host+user 异 port 双档恒零或一行命中。
  const activeSshPresetId = useMemo(
    () => resolveActiveSshPresetId(sshPresets, sshStatus, sshActiveFingerprint),
    [sshPresets, sshStatus, sshActiveFingerprint],
  );

  return {
    sshStatus, mystudioAction, shutdownConfirmOpen, setShutdownConfirmOpen,
    sshTunnelEnabled, sshSwitching, sshTesting, sshRefreshing,
    sshTest, setSshTest, sshTokenMsg, sshNeedsRuntime,
    addingSsh, setAddingSsh, sshAddDraft, setSshAddDraft, sshEditing, setSshEditing, sshEditDraft, setSshEditDraft,
    sshPresets, activeSshPresetId,
    runMystudioAction, switchSshConnection, submitAddSsh, submitEditSsh,
    toggleSshTunnel, testSshConnection, refreshSshTokenNow,
  };
}
