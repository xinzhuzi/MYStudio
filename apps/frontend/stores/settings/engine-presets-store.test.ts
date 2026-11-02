import { beforeEach, describe, expect, it } from "vitest";
import {
  ENGINE_PRESETS_MAX,
  ENGINE_PRESETS_STORAGE_KEY,
  useEnginePresetsStore,
  type EnginePreset,
} from "./engine-presets-store";

/** 等一拍让上一用例 fire-and-forget 的 setItem 全部落定(仿 mcp-servers-store.test 范式)。 */
const flushTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 种子条目:lastUsedAt 递增=越新;数组序=展示序(新在前),尾位=最久未用(LRU 淘汰位)。 */
const makePreset = (host: string, lastUsedAt: number): EnginePreset => ({
  url: `http://${host}:17000`,
  label: `${host}:17000`,
  lastUsedAt,
});

describe("engine presets store(11-02 A4-1)", () => {
  beforeEach(async () => {
    await flushTick();
    useEnginePresetsStore.setState({ presets: [] });
    localStorage.removeItem(ENGINE_PRESETS_STORAGE_KEY);
  });

  it("favorite 入库:label 缺省=hostname,返回 true", () => {
    expect(useEnginePresetsStore.getState().favorite("http://192.168.0.101:17000")).toBe(true);
    const presets = useEnginePresetsStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({
      url: "http://192.168.0.101:17000",
      label: "192.168.0.101:17000",
    });
  });

  it("同 url 加尾斜杠再收藏:去重,长度 1 且置顶", () => {
    useEnginePresetsStore.getState().favorite("http://192.168.0.101:17000");
    expect(useEnginePresetsStore.getState().favorite("http://192.168.0.101:17000/")).toBe(true);
    const presets = useEnginePresetsStore.getState().presets;
    expect(presets).toHaveLength(1); // 去重:尾斜杠归一后同键
    expect(presets[0].url).toBe("http://192.168.0.101:17000"); // 置顶(唯一条目即首位)
  });

  it("全角 ：／ 输入:归一后半角入库", () => {
    expect(useEnginePresetsStore.getState().favorite("http：／／192.168.0.101：17000／")).toBe(true);
    const presets = useEnginePresetsStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0].url).toBe("http://192.168.0.101:17000");
    expect(presets[0].label).toBe("192.168.0.101:17000");
  });

  it("非 http(s) 前缀(ftp://):返回 false 且不入列", () => {
    expect(useEnginePresetsStore.getState().favorite("ftp://x")).toBe(false);
    expect(useEnginePresetsStore.getState().presets).toHaveLength(0);
  });

  it(`预置 ${ENGINE_PRESETS_MAX} 条后再收藏第 9 条:长度守 ${ENGINE_PRESETS_MAX} 且最旧(尾位)被静默淘汰`, () => {
    // 数组序=展示序(新在前):构造 [.8(新) … .1(旧)],尾位=最久未用 .1(G4 淘汰位)
    const ordered = Array.from({ length: ENGINE_PRESETS_MAX }, (_, i) =>
      makePreset(`192.168.0.${ENGINE_PRESETS_MAX - i}`, 1000 + (ENGINE_PRESETS_MAX - i)),
    );
    useEnginePresetsStore.setState({ presets: ordered });
    expect(useEnginePresetsStore.getState().favorite("http://192.168.9.9:17000")).toBe(true);
    const presets = useEnginePresetsStore.getState().presets;
    expect(presets).toHaveLength(ENGINE_PRESETS_MAX);
    expect(presets[0].url).toBe("http://192.168.9.9:17000"); // 新条目置顶
    expect(presets.some((p) => p.url === "http://192.168.0.1:17000")).toBe(false); // 最旧尾位被淘汰
  });

  it("touch 置顶刷新 LRU;remove 删除目标条目", () => {
    useEnginePresetsStore.setState({
      presets: [
        makePreset("192.168.0.1", 3000),
        makePreset("192.168.0.2", 2000),
        makePreset("192.168.0.3", 1000), // 尾位=目标
      ],
    });
    const target = "http://192.168.0.3:17000";
    useEnginePresetsStore.getState().touch(target);
    let presets = useEnginePresetsStore.getState().presets;
    expect(presets[0].url).toBe(target); // 置顶
    expect(presets[0].lastUsedAt).toBeGreaterThan(1000); // 时间戳自旧值 1000 刷新

    useEnginePresetsStore.getState().remove(target);
    presets = useEnginePresetsStore.getState().presets;
    expect(presets.map((p) => p.url)).toEqual([
      "http://192.168.0.1:17000",
      "http://192.168.0.2:17000",
    ]);
  });
});
