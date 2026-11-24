#!/usr/bin/env python3
"""1124 超线拆分·MCP 设置页第二刀(2026-11-24):六个域钩子。
逐字搬移状态/副作用/处理器进 hooks;入口以「镜像 ref + 钩子调用 + 同名额解构」
替换原块,JSX 引用的名字全部解构回原作用域——本步完成后 JSX 零改动。
跨域在跑态(同步守卫读 torch;Torch 守卫读同步):三个恒稳镜像 ref,钩子体每
渲染同步回写,守卫事件时读 mirror.current=上一帧值——与原「每渲染重建闭包、
事件时读上一帧值」语义严格相同。
每一步断言锚点唯一,任何不匹配立即失败不写盘。
"""
D = "frontend/components/panels/settings/"
V = D + "McpSettingsTab.tsx"
src = open(V, encoding="utf-8").read()

def block(start: str, end: str, *, inclusive_end: bool = True) -> str:
    assert src.count(start) == 1, f"起点锚不唯一({src.count(start)}): {start[:70]!r}"
    assert src.count(end) == 1, f"终点锚不唯一({src.count(end)}): {end[:70]!r}"
    i = src.index(start)
    j = src.index(end, i)
    j = j + len(end) if inclusive_end else j
    return src[i:j]

def excl(start: str, next_start: str) -> str:
    b = block(start, next_start, inclusive_end=False)
    return b.rstrip() + "\n"

# ============ 块切取 ============
# —— MCP 服务器域 ——
b_mcp_store = block(
    "  const { servers, addServer, updateServer, removeServer } =\n    useMcpServersStore();\n  const hasRuntime =\n    typeof window !== \"undefined\" && Boolean(window.mcpRuntime);\n",
    "  const hasRuntime =\n    typeof window !== \"undefined\" && Boolean(window.mcpRuntime);\n",
)
b_mcp_states = block(
    "  const [dialogOpen, setDialogOpen] = useState(false);",
    "  const [tests, setTests] = useState<Record<string, TestState>>({});\n",
)
b_mcp_json_states = block(
    "  const [jsonText, setJsonText] = useState(\"\");",
    "  const [jsonError, setJsonError] = useState<string | null>(null);\n",
)
# 注意:中间的 toggleSectionCollapsed 属页面折叠态,留在入口,不进本钩子
b_mcp_effect_cmds = block(
    "  // 0924 安全收口 H4:登记的 stdio 命令清单推送主进程持久注册表",
    "  }, [servers]);\n",
)
b_mcp_effects2 = block(
    "  // 依赖整个 servers 引用(增/改/删都换新数组)",
    "  useEffect(() => () => setTests({}), []);\n",
)
b_mcp_fns = block(
    "  const transportLabel = (transport: McpTransport) =>",
    "  const enabledCount = useMemo(\n    () => servers.filter((s) => s.enabled).length,\n    [servers],\n  );\n",
)
# —— 远程引擎域 ——
b_rem_states = block(
    "  // 远程引擎地址(10-29 D1 终裁):配置态回显/草稿/保存与连通测试进行态。",
    "    | { status: \"ok\"; text: string }\n    | { status: \"error\"; message: string }\n  >({ status: \"idle\" });\n",
)
b_rem_echo = excl(
    "  // (1102 控制中心役)原桥接状态探活已撤:灯收编进引擎双卡(统一 probeEngineUrl",
    "  // SSH 状态回显(1103 终版 Q1 指纹真源)",
)
b_rem_probe = excl(
    "  // 保存=写 sidecar 配置(原子落 App 家 remote-engine.json,即时生效无需重启)。",
    "  const testRemoteConnection = async (rawUrlOverride?: string) => {",
)
b_rem_test = excl(
    "  const testRemoteConnection = async (rawUrlOverride?: string) => {",
    "  const saveRemoteEngine = async (urlOverride?: string) => {",
)
b_rem_save = excl(
    "  const saveRemoteEngine = async (urlOverride?: string) => {",
    "  // ── SSH 远端连接(1103 终版):切换连接/测试连接(仅探活)/立即刷新令牌 ──",
)
b_rem_presets = block(
    "  // ── 引擎地址常用条目(11-02;1103 终版回归纯引擎:零 SSH 字段,D1-D7)──",
    "  const enginePresetRename = useEnginePresetsStore((s) => s.rename);\n",
)
b_rem_active = block(
    "  // R1 生效判定(1102→1103 devices-list):地址指向远端=有远端设备生效,否则本机",
    "  const activeRemoteUrl = remoteActive\n    ? normalizeEngineUrl(remoteEngine?.url ?? \"\")\n    : \"\";\n",
)
b_rem_devices = block(
    "  // ── 设备列表(1103 devices-list 役,模仿 ZCode RemoteConnectionSelection)──",
    "  const [editingDevice, setEditingDevice] = useState<EnginePreset | null>(null);\n  const [editDraft, setEditDraft] = useState({ label: \"\", url: \"\" });\n",
)
b_rem_editsubmit = excl(
    "  const submitEditDevice = () => {",
    "  const transportLabel = (transport: McpTransport) =>",
)
# —— SSH 域 ——
b_ssh_states = block(
    "  // ── SSH 远端连接(11-03 终版:多条连接列表,引擎/SSH 两列表零联动)──",
    "  const [sshEditDraft, setSshEditDraft] =\n    useState<SshFormDraft>(emptySshFormDraft);\n",
)
b_ssh_opscomment = excl(
    "  // ── SSH 远端连接(1103 终版):切换连接/测试连接(仅探活)/立即刷新令牌 ──",
    "  // ── 引擎同步(11-04 engine-sync R3):单真源清单+勾选+逐项同步+结果弹窗 ──",
)
b_ssh_echo = excl(
    "  // SSH 状态回显(1103 终版 Q1 指纹真源)",
    "  // 1114 修:SSH 徽章此前只在挂载取一拍",
)
b_ssh_poll = block(
    "  // 1114 修:SSH 徽章此前只在挂载取一拍",
    "    const timer = window.setInterval(tick, 10_000);\n    return () => window.clearInterval(timer);\n  }, []);\n",
)
b_ssh_ops1 = excl(
    "  const runMystudioAction = async (action: \"launching\" | \"shutting\") => {",
    "  const refreshSshStatusWithSettle = async (maxAttempts = 4) => {",
)
b_ssh_ops2 = excl(
    "  const refreshSshStatusWithSettle = async (maxAttempts = 4) => {",
    "  // ── 引擎地址常用条目(11-02;1103 终版回归纯引擎:零 SSH 字段,D1-D7)──",
)
b_ssh_store = block(
    "  // ── SSH 连接条目(1103 终版:独立多条 store,与引擎列表零联动)──",
    "  const activeSshPresetId = useMemo(\n    () => resolveActiveSshPresetId(sshPresets, sshStatus, sshActiveFingerprint),\n    [sshPresets, sshStatus, sshActiveFingerprint],\n  );\n",
)
# —— 引擎同步域 ——
b_syn_states = block(
    "  // ── 引擎同步(11-04 engine-sync R3):单真源清单+勾选+逐项同步+结果弹窗 ──",
    "  const [engineRestarting, setEngineRestarting] = useState(false);\n",
)
b_syn_mount = excl(
    "  // 挂载即取清单(R3):GET manifest → 渲染勾选清单。",
    "  // 引擎同步清单可见行(skip 态不渲染;skip=my-nodes Q2 归 deploy-dual 管——",
)
b_syn_rows = block(
    "  // 引擎同步清单可见行(skip 态不渲染;skip=my-nodes Q2 归 deploy-dual 管——",
    "  ).filter((item) => item.status !== \"skip\");\n",
)
b_syn_refresh = block(
    "  // 清单回拉(同步完成后回刷版本 / SSH 迟连补拉共用)。",
    "      .catch(() => {}); // 刷新失败静默:行内版本停在旧值,下次开面板自愈\n  };\n",
)
b_syn_late = block(
    "  // SSH 迟连自愈(1122 实弹踩雷):清单只在挂载时拉一次",
    "  }, [sshStatus?.connected]);\n",
)
b_syn_toggle = excl(
    "  const toggleEngineSyncItem = (name: string, checked: boolean) => {",
    "  const startEngineSync = async () => {",
)
b_syn_start = excl(
    "  const startEngineSync = async () => {",
    "  // 重启引擎(R3):SSH schtasks /Run /TN EngineDurable(远端 Windows 计划任务)",
)
b_syn_restart = excl(
    "  // 重启引擎(R3):SSH schtasks /Run /TN EngineDurable(远端 Windows 计划任务)",
    "  const runMystudioAction = async (action: \"launching\" | \"shutting\") => {",
)
# —— Torch 域 ——
b_tor_identity = block(
    "  const sshActiveFingerprint = useSshPresetsStore((s) => s.activeFingerprint);\n  const torchRemoteActive =",
    "  const torchIdentityRef = useRef(torchIdentity);\n  torchIdentityRef.current = torchIdentity;\n",
)
b_tor_states = block(
    "  const [torchInfoState, setTorchInfoState] = useState<{",
    "  const torchTargetInitialized = useRef(false);\n",
)
b_tor_derived = block(
    "  const pinnedTorch =\n    torchInfo?.pinnedTarget ?? torchInfo?.allowedTargets?.[0] ?? \"\";",
    "  const torchVersionDisplay =\n    torchInfo?.current?.torch ??\n    `未知(原因:${torchInfo?.errors?.[0] ?? torchInfoError ?? \"尚未获取引擎版本\"})`;\n",
)
b_tor_follow = block(
    "  const followTorchJob = useCallback(\n    async (jobId: string) => {",
    "    [torchIdentity, torchRemoteActive, updateTorchState],\n  );\n",
)
b_tor_reset = block(
    "  useEffect(() => {\n    setTorchInfoState((previous) =>",
    "  }, [torchIdentity]);\n",
)
b_tor_effect = block(
    "  useEffect(() => {\n    if (torchRunning || remoteEngine === null) return;",
    "    followTorchJob,\n    torchIdentity,\n    updateTorchState,\n  ]);\n",
)
b_tor_start = excl(
    "  const startTorchUpgrade = async () => {",
    "  // ── R2 模型族(1102 控制中心):真源=defaultImageModel;切换即切产线(Q1) ──",
)
# —— 模型族/工作流域 ——
b_fam = block(
    "  // ── R2 模型族(1102 控制中心):真源=defaultImageModel;切换即切产线(Q1) ──",
    "  const i2iCandidates = familyWorkflows.filter((w) =>\n    w.id.includes(\"2_图生图\"),\n  );\n",
)

# ============ 跨域参数化(语义同值) ============
# startEngineSync 守卫:torchRunning / torchInfo?.busy → 镜像读
b_syn_start_paramed = b_syn_start.replace(
    "      engineSyncRunning ||\n      torchRunning ||\n      torchInfo?.busy\n",
    "      engineSyncRunning ||\n      torchRunningMirror.current ||\n      torchBusyMirror.current\n",
)
assert b_syn_start_paramed != b_syn_start, "startEngineSync 守卫参数化未命中"
# startTorchUpgrade 守卫:engineSyncRunning → 镜像读
b_tor_start_paramed = b_tor_start.replace(
    "      !sshStatus?.connected ||\n      engineSyncRunning ||\n",
    "      !sshStatus?.connected ||\n      syncRunningMirror.current ||\n",
)
assert b_tor_start_paramed != b_tor_start, "startTorchUpgrade 守卫参数化未命中"
# 镜像回写(钩子体末,每渲染一次=上一帧值语义)
MIRROR_WRITE_SYNC = "\n  // 跨域镜像回写(Torch 守卫读同步在跑态;每渲染一次=原闭包上一帧值语义)\n  syncRunningMirror.current = engineSyncRunning;\n"
MIRROR_WRITE_TORCH = "\n  // 跨域镜像回写(同步守卫读 Torch 在跑态;每渲染一次=原闭包上一帧值语义)\n  torchRunningMirror.current = torchRunning;\n  torchBusyMirror.current = Boolean(torchInfo?.busy);\n"

def hook_file(path, header, imports, body):
    open(path, "w", encoding="utf-8").write(header + imports + body)

# ============ 1. MCP 服务器域钩子 ============
hook_file(D + "use-mcp-server-admin.ts",
    "/**\n * MCP 服务器管理域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):\n * 登记表 CRUD/连通测试/JSON 导入导出/命令白名单推送。逻辑零改动。\n */\n",
    'import { useEffect, useMemo, useState } from "react";\n'
    'import {\n  useMcpServersStore,\n  exportMcpServersJson,\n  type McpServerConfig,\n  type McpTransport,\n} from "@/stores/mcp/mcp-servers-store";\n'
    'import { configToDraft, emptyDraft, parseEnvLines, type DraftForm, type TestState } from "./McpSettingsParts";\n\n'
    "export function useMcpServerAdmin() {\n",
    b_mcp_store + b_mcp_states + b_mcp_json_states + "\n" + b_mcp_effect_cmds + "\n" + b_mcp_effects2 + "\n" + b_mcp_fns +
    "\n  return {\n    servers, addServer, updateServer, removeServer, hasRuntime,\n    dialogOpen, setDialogOpen, editingId, draft, setDraft, formError, setFormError, tests,\n    jsonText, setJsonText, jsonError, setJsonError,\n    openCreate, openEdit, submit, runTest, enabledCount, transportLabel,\n  };\n}\n")

# ============ 2. 远程引擎域钩子 ============
hook_file(D + "use-remote-engine-admin.ts",
    "/**\n * 远程引擎域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):\n * 引擎地址配置/探活/设备列表增删改/生效切换。逻辑零改动。\n */\n",
    'import { useEffect, useState } from "react";\n'
    'import {\n  normalizeEngineUrl, useEnginePresetsStore, type EnginePreset,\n} from "@/stores/settings/engine-presets-store";\n'
    'import {\n  getRemoteEngine,\n  setRemoteEngine,\n  probeEngineUrl,\n  SIDECAR_DOWN_GUIDANCE,\n  isSidecarDownError,\n  type ComfyRemoteEngineStatus,\n} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";\n'
    'import { notifyRemoteEngineChanged } from "@/lib/studio/engine-line/resolve-engine-base-url";\n'
    'import { toast } from "sonner";\n'
    'import { comfyVersionLabel } from "./McpSettingsParts";\n\n'
    "export function useRemoteEngineAdmin() {\n",
    b_rem_states + b_rem_echo + b_rem_probe + b_rem_test + b_rem_save + "\n" + b_rem_presets + b_rem_active + b_rem_devices + b_rem_editsubmit +
    "\n  return {\n    remoteEngine, remoteDraft, setRemoteDraft, remoteSaving, remoteTest, setRemoteTest,\n    remoteProbing, engineOkDialog, setEngineOkDialog,\n    enginePresets, enginePresetFavorite, enginePresetTouch, enginePresetRemove, enginePresetRename,\n    remoteActive, activeRemoteUrl,\n    addingDevice, setAddingDevice, addDraft, setAddDraft,\n    editingDevice, setEditingDevice, editDraft, setEditDraft,\n    testRemoteConnection, saveRemoteEngine, activateDevice, submitAddDevice, submitEditDevice,\n  };\n}\n")

# ============ 3. SSH 域钩子 ============
hook_file(D + "use-ssh-admin.ts",
    "/**\n * SSH 远端连接域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):\n * 多条连接列表/切换/探活/令牌刷新/隧道开关/远端 MYStudio 拉起与关闭。逻辑零改动。\n */\n",
    'import { useEffect, useMemo, useRef, useState } from "react";\n'
    'import { useSshPresetsStore, type SshPreset } from "@/stores/settings/ssh-presets-store";\n'
    'import {\n  getComfySshStatus,\n  setComfySshConfig,\n  testComfySshConnection,\n  refreshComfySshToken,\n  launchRemoteMystudio,\n  shutdownRemoteMystudio,\n  SIDECAR_DOWN_GUIDANCE,\n  isSidecarDownError,\n  type ComfySshStatus,\n  type ComfySshTestReply,\n} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";\n'
    'import { toast } from "sonner";\n'
    'import { emptySshFormDraft, resolveActiveSshPresetId, sshDraftToInput, type SshFormDraft } from "./McpSettingsParts";\n\n'
    "export function useSshAdmin() {\n",
    b_ssh_states + b_ssh_opscomment + "\n  const sshActiveFingerprint = useSshPresetsStore((s) => s.activeFingerprint);\n" + b_ssh_echo + b_ssh_poll + b_ssh_ops1 + b_ssh_ops2 + b_ssh_store +
    "\n  return {\n    sshStatus, mystudioAction, shutdownConfirmOpen, setShutdownConfirmOpen,\n    sshTunnelEnabled, sshSwitching, sshTesting, sshRefreshing,\n    sshTest, setSshTest, sshTokenMsg, sshNeedsRuntime,\n    addingSsh, setAddingSsh, sshAddDraft, setSshAddDraft, sshEditing, setSshEditing, sshEditDraft, setSshEditDraft,\n    sshPresets, activeSshPresetId,\n    runMystudioAction, switchSshConnection, submitAddSsh, submitEditSsh,\n    toggleSshTunnel, testSshConnection, refreshSshTokenNow,\n  };\n}\n")

# ============ 4. 引擎同步域钩子 ============
hook_file(D + "use-engine-sync-admin.ts",
    "/**\n * 引擎同步域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):\n * 单真源清单/勾选/逐项同步/结果弹窗/引擎重启。逻辑零改动。\n * 在跑态守卫读镜像 ref(Torch 域每渲染回写)=原闭包上一帧值语义。\n */\n",
    'import { useEffect, useState } from "react";\n'
    'import {\n  getEngineSyncManifest,\n  getEnginePluginHealth,\n  syncEngine,\n  restartRemoteEngine,\n  SIDECAR_DOWN_GUIDANCE,\n  isSidecarDownError,\n  ComfySidecarHttpError,\n  ENGINE_SYNC_OVERALL_TIMEOUT_MS,\n  type EnginePluginHealth,\n  type EngineSyncManifest,\n  type EngineSyncManifestItem,\n  type EngineSyncResultItem,\n} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";\n'
    'import { toast } from "sonner";\n\n'
    "export function useEngineSyncAdmin({\n  sshConnected,\n  torchRunningMirror,\n  torchBusyMirror,\n  syncRunningMirror,\n}: {\n"
    "  sshConnected: boolean;\n  torchRunningMirror: { current: boolean };\n  torchBusyMirror: { current: boolean };\n  syncRunningMirror: { current: boolean };\n"
    "}) {\n",
    b_syn_states + b_syn_mount + b_syn_rows + b_syn_refresh
    # 迟连自愈 effect:deps 里 sshStatus?.connected → 参数 sshConnected(同值)
    + b_syn_late.replace(
        "    if (sshStatus?.connected && (engineSyncManifest === null || engineSyncError)) {",
        "    if (sshConnected && (engineSyncManifest === null || engineSyncError)) {",
    ).replace(
        "  }, [sshStatus?.connected]);\n",
        "  }, [sshConnected]);\n",
    )
    + b_syn_toggle + b_syn_start_paramed + b_syn_restart + MIRROR_WRITE_SYNC +
    "\n  return {\n    engineSyncManifest, enginePluginHealth, engineSyncError, engineSyncChecked,\n    engineSyncProgress, engineSyncRunning, engineSyncDialog, setEngineSyncDialog,\n    engineRestarting, engineSyncRows, refreshEngineSyncManifest,\n    toggleEngineSyncItem, startEngineSync, restartEngine,\n  };\n}\n")

# ============ 5. Torch 域钩子 ============
hook_file(D + "use-torch-upgrade-admin.ts",
    "/**\n * 引擎 PyTorch/CUDA 升级域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):\n * 引擎版本探测/三件套对照/升级启动与任务跟随。逻辑零改动。\n * 在跑态守卫读镜像 ref(引擎同步域每渲染回写)=原闭包上一帧值语义。\n */\n",
    'import { useCallback, useEffect, useRef, useState } from "react";\n'
    'import { normalizeEngineUrl } from "@/stores/settings/engine-presets-store";\n'
    'import { useSshPresetsStore } from "@/stores/settings/ssh-presets-store";\n'
    'import {\n  comfySidecarRequest,\n  ComfySidecarHttpError,\n  getEngineTorchInfo,\n  startEngineTorchUpgrade,\n  pollJobUntilTerminal,\n  type ComfyRemoteEngineStatus,\n  type ComfySshStatus,\n  type EngineTorchInfo,\n  type SidecarJobReply,\n  type TorchUpgradeChannel,\n} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";\n\n'
    "export function useTorchUpgradeAdmin({\n  remoteEngine,\n  sshStatus,\n  syncRunningMirror,\n  torchRunningMirror,\n  torchBusyMirror,\n}: {\n"
    "  remoteEngine: ComfyRemoteEngineStatus | null;\n  sshStatus: ComfySshStatus | null;\n  syncRunningMirror: { current: boolean };\n  torchRunningMirror: { current: boolean };\n  torchBusyMirror: { current: boolean };\n"
    "}) {\n",
    "  // R1 生效判定与生效地址(Torch 恒等式所需;与远程引擎域各自独立求值,同式同值)\n"
    "  const remoteActive =\n    remoteEngine?.source === \"settings\" && Boolean(remoteEngine.url);\n  const activeRemoteUrl = remoteActive\n    ? normalizeEngineUrl(remoteEngine?.url ?? \"\")\n    : \"\";\n"
    + b_tor_identity + b_tor_states + b_tor_derived + b_tor_follow + b_tor_reset + b_tor_effect + b_tor_start_paramed + MIRROR_WRITE_TORCH +
    "\n  return {\n    torchRemoteActive, torchIdentity, torchInfo, torchInfoError,\n    torchTarget, setTorchTarget, torchChannel, setTorchChannel,\n    torchConfirm, setTorchConfirm, torchConfirmPinned, setTorchConfirmPinned,\n    torchRunning, torchJob, torchResultOpen, setTorchResultOpen, torchTrackingWarning,\n    pinnedTorch, pinnedVersion, torchChangeRows, torchVerified, torchNeedsUpdate, torchLedgerOnly,\n    torchVersionDisplay, startTorchUpgrade, followTorchJob,\n  };\n}\n")

# ============ 6. 模型族/工作流域钩子 ============
hook_file(D + "use-engine-family-workflows.ts",
    "/**\n * 模型族与工作流绑定域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):\n * 产线族切换(写全局默认出图模型)+当前族工作流清单与双类型绑定。逻辑零改动。\n */\n",
    'import { useEffect, useState } from "react";\n'
    'import { toast } from "sonner";\n'
    'import { useAppSettingsStore } from "@/stores/app/app-settings-store";\n'
    'import { useWorkflowBindingsStore } from "@/stores/settings/workflow-bindings-store";\n'
    'import { engineFamilyMeta } from "@/lib/studio/engine-line/family-catalog";\n'
    'import { comfySidecarRequest } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";\n\n'
    "export function useEngineFamilyWorkflows() {\n",
    b_fam +
    "\n  return {\n    defaultImageModel, currentFamily, handleFamilySwitch,\n    bindings, familyWorkflows, workflowsLoading, workflowsError,\n    t2iCandidates, i2iCandidates,\n  };\n}\n")

# ============ 入口改写 ============
HOOK_CALLS = """  // 跨域在跑态镜像(恒稳 ref):同步守卫读 Torch 在跑/Torch 守卫读同步在跑。
  // 钩子体每渲染回写一次;守卫事件时读 .current=上一帧值,与原「每渲染重建闭包、
  // 事件时读上一帧值」语义相同。
  const torchRunningMirror = useRef(false);
  const torchBusyMirror = useRef(false);
  const syncRunningMirror = useRef(false);
  const {
    servers, addServer, updateServer, removeServer, hasRuntime,
    dialogOpen, setDialogOpen, editingId, draft, setDraft, formError, setFormError, tests,
    jsonText, setJsonText, jsonError, setJsonError,
    openCreate, openEdit, submit, runTest, enabledCount, transportLabel,
  } = useMcpServerAdmin();
  const {
    remoteEngine, remoteSaving, remoteTest, setRemoteTest,
    remoteProbing, engineOkDialog, setEngineOkDialog,
    enginePresets, enginePresetRemove, remoteActive, activeRemoteUrl,
    addingDevice, setAddingDevice, addDraft, setAddDraft,
    editingDevice, setEditingDevice, editDraft, setEditDraft,
    testRemoteConnection, activateDevice, submitAddDevice, submitEditDevice,
  } = useRemoteEngineAdmin();
  const {
    sshStatus, mystudioAction, shutdownConfirmOpen, setShutdownConfirmOpen,
    sshTunnelEnabled, sshSwitching, sshTesting, sshRefreshing,
    sshTest, setSshTest, sshTokenMsg, sshNeedsRuntime,
    addingSsh, setAddingSsh, sshAddDraft, setSshAddDraft, sshEditing, setSshEditing, sshEditDraft, setSshEditDraft,
    sshPresets, activeSshPresetId,
    runMystudioAction, switchSshConnection, submitAddSsh, submitEditSsh,
    toggleSshTunnel, testSshConnection, refreshSshTokenNow,
  } = useSshAdmin();
  const {
    engineSyncChecked, engineSyncProgress, engineSyncRunning, engineSyncDialog, setEngineSyncDialog,
    engineRestarting, engineSyncRows, engineSyncError, enginePluginHealth,
    toggleEngineSyncItem, startEngineSync, restartEngine,
  } = useEngineSyncAdmin({
    sshConnected: Boolean(sshStatus?.connected),
    torchRunningMirror,
    torchBusyMirror,
    syncRunningMirror,
  });
  const {
    torchInfo, torchTarget, setTorchTarget, torchChannel, setTorchChannel,
    torchConfirm, setTorchConfirm, torchConfirmPinned, setTorchConfirmPinned,
    torchRunning, torchJob, torchResultOpen, setTorchResultOpen, torchTrackingWarning,
    pinnedVersion, torchChangeRows, torchVerified, torchNeedsUpdate, torchLedgerOnly,
    torchVersionDisplay, startTorchUpgrade,
  } = useTorchUpgradeAdmin({
    remoteEngine,
    sshStatus,
    syncRunningMirror,
    torchRunningMirror,
    torchBusyMirror,
  });
  const {
    defaultImageModel, currentFamily, handleFamilySwitch,
    bindings, familyWorkflows, workflowsLoading, workflowsError,
    t2iCandidates, i2iCandidates,
  } = useEngineFamilyWorkflows();
"""

# 各块替换:第一个块位置插钩子调用,其余删除
def cut(b, label):
    global src
    assert src.count(b) == 1, f"{label}: 块在当前源不唯一({src.count(b)})"
    return b

cut_list = [
    (b_mcp_store, "MCP store"), (b_mcp_states, "MCP states"), (b_mcp_json_states, "MCP json"),
    (b_mcp_effect_cmds, "MCP cmds effect"), (b_mcp_effects2, "MCP effects2"), (b_mcp_fns, "MCP fns"),
    (b_rem_states, "rem states"), (b_rem_echo, "rem echo"), (b_rem_probe, "rem probe"),
    (b_rem_test, "rem test"), (b_rem_save, "rem save"), (b_rem_presets, "rem presets"),
    (b_rem_active, "rem active"), (b_rem_devices, "rem devices"), (b_rem_editsubmit, "rem editsubmit"),
    (b_ssh_states, "ssh states"), (b_ssh_opscomment, "ssh ops comment"), (b_ssh_echo, "ssh echo"),
    (b_ssh_poll, "ssh poll"), (b_ssh_ops1, "ssh ops1"), (b_ssh_ops2, "ssh ops2"), (b_ssh_store, "ssh store"),
    (b_syn_states, "syn states"), (b_syn_mount, "syn mount"), (b_syn_rows, "syn rows"),
    (b_syn_refresh, "syn refresh"), (b_syn_late, "syn late"), (b_syn_toggle, "syn toggle"),
    (b_syn_start, "syn start"), (b_syn_restart, "syn restart"),
    (b_tor_identity, "tor identity"), (b_tor_states, "tor states"), (b_tor_derived, "tor derived"),
    (b_tor_follow, "tor follow"), (b_tor_reset, "tor reset"), (b_tor_effect, "tor effect"),
    (b_tor_start, "tor start"),
    (b_fam, "family"),
]
# 全部块此刻仍须在源里各出现一次(切自同一源,天然成立)
for b, label in cut_list:
    cut(b, label)
# 替换:所有块 → "";b_mcp_store → 钩子调用
src = src.replace(b_mcp_store, HOOK_CALLS, 1)
for b, label in cut_list[1:]:
    src = src.replace(b, "", 1)
# 收掉三连以上空行
import re
src = re.sub(r"\n{4,}", "\n\n\n", src)
HOOK_IMPORT_ANCHOR = 'import { SecureVaultBanner } from "./SecureVaultBanner";\n'
assert src.count(HOOK_IMPORT_ANCHOR) == 1, "钩子导入锚不唯一"
src = src.replace(HOOK_IMPORT_ANCHOR, HOOK_IMPORT_ANCHOR + "".join(
    f'import {{ {name} }} from "./{path}";\n' for name, path in [
        ("useMcpServerAdmin", "use-mcp-server-admin"),
        ("useRemoteEngineAdmin", "use-remote-engine-admin"),
        ("useSshAdmin", "use-ssh-admin"),
        ("useEngineSyncAdmin", "use-engine-sync-admin"),
        ("useTorchUpgradeAdmin", "use-torch-upgrade-admin"),
        ("useEngineFamilyWorkflows", "use-engine-family-workflows"),
    ]), 1)

open(V, "w", encoding="utf-8").write(src)
new_hooks = ["use-mcp-server-admin", "use-remote-engine-admin", "use-ssh-admin",
             "use-engine-sync-admin", "use-torch-upgrade-admin", "use-engine-family-workflows"]
print(f"入口 {len(open(V, encoding='utf-8').read().splitlines())} 行")
for f in new_hooks:
    n = len(open(D + f + ".ts", encoding="utf-8").read().splitlines())
    print(f"  {f}.ts: {n} 行")
