/**
 * 远程引擎域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):
 * 引擎地址配置/探活/设备列表增删改/生效切换。逻辑零改动。
 */
import { useEffect, useState } from "react";
import {
  normalizeEngineUrl, useEnginePresetsStore, type EnginePreset,
} from "@/stores/settings/engine-presets-store";
import {
  getRemoteEngine,
  setRemoteEngine,
  probeEngineUrl,
  SIDECAR_DOWN_GUIDANCE,
  isSidecarDownError,
  type ComfyRemoteEngineStatus,
} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import { notifyRemoteEngineChanged } from "@/lib/studio/engine-line/resolve-engine-base-url";
import { toast } from "sonner";
import { comfyVersionLabel } from "./McpSettingsParts";

export function useRemoteEngineAdmin() {
  // 远程引擎地址(10-29 D1 终裁):配置态回显/草稿/保存与连通测试进行态。
  const [remoteEngine, setRemoteEngineState] =
    useState<ComfyRemoteEngineStatus | null>(null);
  const [remoteDraft, setRemoteDraft] = useState("");
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteTest, setRemoteTest] = useState<
    | { status: "idle" }
    | { status: "ok"; text: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  // (1102 控制中心役)原桥接状态探活已撤:灯收编进引擎双卡(统一 probeEngineUrl
  // 一个口径,本地/远端不再两套探活);bridge state 一并退役。

  // 远程引擎配置回显(sidecar 未运行时静默空态——首开设置页不弹错)。
  useEffect(() => {
    let cancelled = false;
    getRemoteEngine()
      .then((status) => {
        if (cancelled) return;
        setRemoteEngineState(status);
        setRemoteDraft(status.url ?? "");
      })
      .catch(() => {
        /* sidecar 未运行/端点不可达:保持空态,保存时会给出大白话 */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // 保存=写 sidecar 配置(原子落 App 家 remote-engine.json,即时生效无需重启)。
  // 保存即测两步探活(10-29 T17/问题#2):①GET /comfy/engine/remote 回读确认
  // url+source==='settings'——保存生效即远程接管,不再依赖 controller IPC 的
  // comfyui-bridge 行(该行版本在新引擎地址下不即时刷新,旧探活偶落
  // 「暂未探活成功」误报);②直连生效引擎 /system_stats(引擎原生 API,
  // 不走 controller)拿 comfyui_version+devices[0].name。两步都通=全绿;
  // ①通②不通=已生效但引擎未启动的诚实降级;失败走既有 error 文案。
  // 测试连接(仅探活不保存,11-02 用户令):直连输入框地址(空则当前生效地址)的
  // /system_stats;与 MCP 服务器卡片「测试连接」同范式;结果共用 remoteTest 展示位。
  const [remoteProbing, setRemoteProbing] = useState(false);
  // 1102 F4:探活成功详情弹窗(headline=实机版本/显卡,note=保存态说明);null=关
  const [engineOkDialog, setEngineOkDialog] = useState<{
    headline: string;
    note: string;
  } | null>(null);
  const testRemoteConnection = async (rawUrlOverride?: string) => {
    // rawUrlOverride(1103 devices-list):设备行/添加表单直传待探地址;缺省=输入框草稿
    const base =
      normalizeEngineUrl(rawUrlOverride ?? remoteDraft) ||
      normalizeEngineUrl(remoteEngine?.effective ?? "");
    if (!base) {
      setRemoteTest({
        status: "error",
        message: "先填引擎地址再测试(留空=本机引擎)",
      });
      return;
    }
    if (!/^https?:\/\//.test(base)) {
      setRemoteTest({
        status: "error",
        message: `引擎地址须为 http(s)://主机[:端口] 形态(如 http://192.168.0.101:17000;当前值:${JSON.stringify(
          remoteDraft.trim(),
        )}——若是中文输入法打出的全角冒号/斜杠,已自动归一仍不过请检查其余字符)`,
      });
      return;
    }
    setRemoteProbing(true);
    setRemoteTest({ status: "idle" });
    try {
      // 走 sidecar 服务端代理探活(11-02:渲染层 CSP connect-src 不放行 http+局域网
      // IP,直连 fetch 恒被拦——引擎明明在跑也报「连接失败」)。
      const probe = await probeEngineUrl(base);
      if (probe.ok) {
        // 1102 F4 终态:成功=弹窗即全部;1103 修:note 随被测地址与生效引擎
        // 的关系分口径(旧「未保存」文案是输入框时代残留,设备列表已无「保存
        // 并测试」按钮——测当前生效机=已生效,测其他设备=点行切换)
        const testingActive =
          remoteEngine?.source === "settings" &&
          base === normalizeEngineUrl(remoteEngine.url ?? "");
        setEngineOkDialog({
          headline: `连接成功(${comfyVersionLabel(probe.comfyui_version ?? "未知版本", probe.device ?? null)})`,
          note: testingActive
            ? "该设备已是当前生效引擎"
            : "点该设备行即可切换生效",
        });
        setRemoteTest({ status: "idle" });
      } else {
        setRemoteTest({
          status: "error",
          message: `连接失败(${base})——引擎可能未启动或地址不可达`,
        });
      }
    } catch (error) {
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : `连接失败(${base})——引擎可能未启动或地址不可达`;
      setRemoteTest({ status: "error", message });
    } finally {
      setRemoteProbing(false);
    }
  };

  // urlOverride(11-02 一键切换):常用条目直传归一 url——坑①:setRemoteDraft 是
  // 异步 setState,同帧闭包里的 remoteDraft 仍是旧值,不传参会把旧草稿存出去。
  const saveRemoteEngine = async (urlOverride?: string) => {
    const url = normalizeEngineUrl(urlOverride ?? remoteDraft);
    setRemoteSaving(true);
    setRemoteTest({ status: "idle" });
    try {
      await setRemoteEngine(url);
      const status = await getRemoteEngine();
      setRemoteEngineState(status);
      // 引擎地址变更广播(1102 R1):画布 src/配置页提示条等跟随视图零重启刷新。
      notifyRemoteEngineChanged();
      toast.success(url ? "引擎地址已保存,即时生效" : "已恢复本机引擎");
      if (url) {
        // ①回读校验:保存的 url 已生效且来源=设置页(远程真正接管;
        // 后端写库前 .rstrip("/"),比较两侧同样去尾斜杠防假阴)。
        const normalizedSaved = url.replace(/\/+$/, "");
        if (status.source !== "settings" || status.url !== normalizedSaved) {
          throw new Error(
            `保存后回读校验失败:生效地址 ${status.effective}(来源 ${status.source}),与刚保存的 ${normalizedSaved} 不一致`,
          );
        }
        setRemoteTest({
          status: "ok",
          text: `已保存并生效(${status.effective}),引擎探活中…`,
        });
        // 保存成功即自动收藏(Q2 双通道①):favorite 去重置顶幂等+touch 刷新 LRU;
        // 本机(空串)不入列(外层 if (url) 已挡)。
        enginePresetFavorite(url);
        enginePresetTouch(url);
        // ②引擎直探:改走 sidecar 代理 /comfy/engine/probe(11-02:渲染层 CSP 不放行
        // http+局域网 IP,直连 fetch 恒被拦,T17 成功分支从未真正可达)。
        try {
          const probe = await probeEngineUrl(status.effective);
          if (probe.ok) {
            // 1102 F4 终态:成功=弹窗即全部,行内不再重复提示(用户令)
            setEngineOkDialog({
              headline: `已连通远端引擎(${comfyVersionLabel(probe.comfyui_version ?? "未知版本", probe.device ?? null)})`,
              note: "产物将自动取回",
            });
            setRemoteTest({ status: "idle" });
          } else {
            setRemoteTest({
              status: "ok",
              text: `已保存并生效(${status.effective}),引擎探活暂不可达(引擎可能未启动)`,
            });
          }
        } catch {
          setRemoteTest({
            status: "ok",
            text: `已保存并生效(${status.effective}),引擎探活暂不可达(引擎可能未启动)`,
          });
        }
      }
    } catch (error) {
      // T9/G8:sidecar 未在驾是保存链第一故障源——探活 false/连接失败两族错误
      // 统一换算成同源指路文案(常量真源=桥文件 sidecarLikelyUp 门禁)。
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : error instanceof Error
          ? error.message
          : "保存失败";
      setRemoteTest({ status: "error", message });
      toast.error(message);
    } finally {
      setRemoteSaving(false);
    }
  };

  // ── 引擎地址常用条目(11-02;1103 终版回归纯引擎:零 SSH 字段,D1-D7)──
  const enginePresets = useEnginePresetsStore((s) => s.presets);
  const enginePresetFavorite = useEnginePresetsStore((s) => s.favorite);
  const enginePresetTouch = useEnginePresetsStore((s) => s.touch);
  const enginePresetRemove = useEnginePresetsStore((s) => s.remove);
  const enginePresetRename = useEnginePresetsStore((s) => s.rename);
  // R1 生效判定(1102→1103 devices-list):地址指向远端=有远端设备生效,否则本机
  const remoteActive =
    remoteEngine?.source === "settings" && Boolean(remoteEngine.url);
  const activeRemoteUrl = remoteActive
    ? normalizeEngineUrl(remoteEngine?.url ?? "")
    : "";
  // ── 设备列表(1103 devices-list 役,模仿 ZCode RemoteConnectionSelection)──
  // 激活设备:点设备行即切换(坑①沿用:必传 urlOverride——setRemoteDraft 异步落帧)。
  // 1103 终版(D3):activateDevice 只 POST /comfy/engine/remote——引擎与 SSH 零
  // 联动,切引擎绝不碰 SSH 配置(前案双写块全数退役)。
  const activateDevice = (url: string) => {
    setRemoteDraft(url);
    void saveRemoteEngine(url);
  };

  // 添加设备表单:名字选填(缺省 hostname)+地址;保存=保存生效(saveRemoteEngine
  // 成功即自动 favorite 入列)+ 自定义名 rename 覆盖。1103 终版(D4):纯引擎
  // 表单,SSH 字段退役——SSH 连接在下方 SSH 列表独立管理。
  const [addingDevice, setAddingDevice] = useState(false);
  const [addDraft, setAddDraft] = useState({ label: "", url: "" });
  const submitAddDevice = () => {
    const url = normalizeEngineUrl(addDraft.url);
    if (!/^https?:\/\//.test(url)) {
      setRemoteTest({
        status: "error",
        message: "地址格式不对(须 http(s)://主机[:端口];全角：／已自动归一)",
      });
      return;
    }
    const label = addDraft.label.trim();
    setRemoteDraft(url);
    void saveRemoteEngine(url).then(() => {
      // favorite 已入列(label 缺省=hostname);用户填了名→rename 覆盖
      if (label) enginePresetRename(url, label);
    });
    setAddingDevice(false);
  };

  // 编辑设备(名字/地址):地址不变=只 rename;地址变=删旧加新(自定义名带入),
  // 旧地址若正是生效机→保存并激活新地址(生效连续性);否则不动引擎。
  const [editingDevice, setEditingDevice] = useState<EnginePreset | null>(null);
  const [editDraft, setEditDraft] = useState({ label: "", url: "" });
  const submitEditDevice = () => {
    if (!editingDevice) return;
    const oldUrl = editingDevice.url;
    const newUrl = normalizeEngineUrl(editDraft.url);
    const label = editDraft.label.trim();
    if (newUrl === oldUrl) {
      enginePresetRename(oldUrl, label);
    } else {
      const wasActive =
        remoteActive && normalizeEngineUrl(remoteEngine?.url ?? "") === oldUrl;
      enginePresetRemove(oldUrl);
      if (/^https?:\/\//.test(newUrl)) enginePresetFavorite(newUrl, label);
      if (wasActive) activateDevice(newUrl);
    }
    setEditingDevice(null);
    toast.success("设备已更新");
  };

  return {
    remoteEngine, remoteDraft, setRemoteDraft, remoteSaving, remoteTest, setRemoteTest,
    remoteProbing, engineOkDialog, setEngineOkDialog,
    enginePresets, enginePresetFavorite, enginePresetTouch, enginePresetRemove, enginePresetRename,
    remoteActive, activeRemoteUrl,
    addingDevice, setAddingDevice, addDraft, setAddDraft,
    editingDevice, setEditingDevice, editDraft, setEditDraft,
    testRemoteConnection, saveRemoteEngine, activateDevice, submitAddDevice, submitEditDevice,
  };
}
