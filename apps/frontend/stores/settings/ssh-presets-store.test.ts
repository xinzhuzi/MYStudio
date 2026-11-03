// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  SSH_PRESETS_MAX,
  SSH_PRESETS_STORAGE_KEY,
  useSshPresetsStore,
  type SshPreset,
} from "./ssh-presets-store";

/** 等一拍让上一用例 fire-and-forget 的 setItem 全部落定(仿 engine-presets-store.test 范式)。 */
const flushTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 种子条目:lastUsedAt 递增=越新;数组序=展示序(新在前),尾位=最久未用(LRU 淘汰位)。 */
const makePreset = (host: string, lastUsedAt: number): SshPreset => ({
  id: `id-${host}`,
  label: host,
  host,
  port: 22,
  user: "zbj",
  keyPath: "",
  lastUsedAt,
});

describe("ssh presets store(11-03 终版 R1:多条 SSH 连接,与引擎列表零联动)", () => {
  beforeEach(async () => {
    await flushTick();
    useSshPresetsStore.setState({ presets: [], activeFingerprint: null });
    localStorage.removeItem(SSH_PRESETS_STORAGE_KEY);
  });

  it("save 入库:label 缺省=host,port 缺省/非法回退 22,返回落库条目(带 id)", () => {
    const saved = useSshPresetsStore.getState().save({ host: "192.168.0.101", user: "zbj" });
    expect(saved).not.toBeNull();
    expect(saved?.label).toBe("192.168.0.101"); // label 缺省=host
    expect(saved?.port).toBe(22); // port 缺省=22
    expect(saved?.id).toBeTruthy(); // id=uuid 自动生成
    const presets = useSshPresetsStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ host: "192.168.0.101", user: "zbj", keyPath: "" });

    // port 非法串(NaN)同样回退 22(表单 string 承接输入态的兜底)
    const saved2 = useSshPresetsStore.getState().save({ host: "192.168.0.102", port: Number.NaN });
    expect(saved2?.port).toBe(22);
  });

  it("save host 空=非法返回 null 不入库(调用方给文案)", () => {
    expect(useSshPresetsStore.getState().save({ host: "  ", user: "zbj" })).toBeNull();
    expect(useSshPresetsStore.getState().presets).toHaveLength(0);
  });

  it("save 同 id=按 id 去重更新(编辑 dialog 保留 id 改字段),不入重复行", () => {
    const saved = useSshPresetsStore.getState().save({ host: "192.168.0.101", user: "zbj" });
    expect(saved).not.toBeNull();
    const updated = useSshPresetsStore.getState().save({
      id: saved!.id,
      host: "10.0.0.9",
      port: 2222,
      user: "ops",
      keyPath: "/Users/ops/.ssh/id",
      label: "备用机",
    });
    expect(updated?.id).toBe(saved!.id);
    const presets = useSshPresetsStore.getState().presets;
    expect(presets).toHaveLength(1); // 同 id 去重:不新增行
    expect(presets[0]).toMatchObject({ host: "10.0.0.9", port: 2222, label: "备用机" });
  });

  it(`预置 ${SSH_PRESETS_MAX} 条后再存第 ${SSH_PRESETS_MAX + 1} 条:长度守 ${SSH_PRESETS_MAX} 且最旧(尾位)被静默淘汰`, () => {
    // 数组序=展示序(新在前):构造 [.8(新) … .1(旧)],尾位=最久未用 .1(淘汰位)
    const ordered = Array.from({ length: SSH_PRESETS_MAX }, (_, i) =>
      makePreset(`192.168.0.${SSH_PRESETS_MAX - i}`, 1000 + (SSH_PRESETS_MAX - i)),
    );
    useSshPresetsStore.setState({ presets: ordered });
    useSshPresetsStore.getState().save({ host: "192.168.9.9" });
    const presets = useSshPresetsStore.getState().presets;
    expect(presets).toHaveLength(SSH_PRESETS_MAX);
    expect(presets[0].host).toBe("192.168.9.9"); // 新条目置顶
    expect(presets.some((p) => p.host === "192.168.0.1")).toBe(false); // 最旧尾位被淘汰
  });

  it("touch 置顶刷新 LRU;remove 删除目标条目", () => {
    useSshPresetsStore.setState({
      presets: [
        makePreset("192.168.0.1", 3000),
        makePreset("192.168.0.2", 2000),
        makePreset("192.168.0.3", 1000), // 尾位=目标
      ],
    });
    const target = "id-192.168.0.3";
    useSshPresetsStore.getState().touch(target);
    let presets = useSshPresetsStore.getState().presets;
    expect(presets[0].id).toBe(target); // 置顶
    expect(presets[0].lastUsedAt).toBeGreaterThan(1000); // 时间戳自旧值 1000 刷新

    useSshPresetsStore.getState().remove(target);
    presets = useSshPresetsStore.getState().presets;
    expect(presets.map((p) => p.host)).toEqual(["192.168.0.1", "192.168.0.2"]);
  });

  it("明文持久化:save 后 localStorage 落 mystudio-ssh-presets 键(非加密链,Q2 裁定)", async () => {
    useSshPresetsStore.getState().save({ host: "192.168.0.101", user: "zbj", label: "Windows 主力" });
    await flushTick();
    const raw = window.localStorage.getItem(SSH_PRESETS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    // 明文可直读出 host(JSON 非 safeStorage 密文)
    expect(raw).toContain("192.168.0.101");
    expect(raw).toContain("Windows 主力");
  });

  it("③当前连接指纹:setActiveFingerprint 落 state 且随 partialize 持久化(重开设置页 port 侧消歧事实仍在)", async () => {
    expect(useSshPresetsStore.getState().activeFingerprint).toBeNull(); // 初始未知
    useSshPresetsStore.getState().setActiveFingerprint({ host: "192.168.0.101", port: 2222, user: "zbj" });
    expect(useSshPresetsStore.getState().activeFingerprint).toEqual({ host: "192.168.0.101", port: 2222, user: "zbj" });
    await flushTick();
    const persisted = JSON.parse(window.localStorage.getItem(SSH_PRESETS_STORAGE_KEY) ?? "{}") as {
      state?: { activeFingerprint?: { host: string; port: number; user: string } | null };
    };
    // partialize 含 activeFingerprint:指纹随 store 同键落盘,跨重开存活
    expect(persisted.state?.activeFingerprint).toEqual({ host: "192.168.0.101", port: 2222, user: "zbj" });
  });
});
