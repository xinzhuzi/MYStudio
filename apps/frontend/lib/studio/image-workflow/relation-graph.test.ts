import { describe, expect, it } from "vitest";
import { relatedEdges } from "./relation-graph";

const EDGES = [
  { id: "e1", source: "a", target: "b" },
  { id: "e2", source: "b", target: "c" },
  { id: "e3", source: "d", target: "e" },
];

describe("relatedEdges", () => {
  it("中段节点:入边+出边一度命中", () => {
    expect([...relatedEdges(EDGES, "b")].sort()).toEqual(["e1", "e2"]);
  });
  it("端点节点:只命中相连边", () => {
    expect([...relatedEdges(EDGES, "a")]).toEqual(["e1"]);
    expect([...relatedEdges(EDGES, "c")]).toEqual(["e2"]);
  });
  it("无关节点/无选中:空集", () => {
    expect(relatedEdges(EDGES, "zzz").size).toBe(0);
    expect(relatedEdges(EDGES, null).size).toBe(0);
  });
});
