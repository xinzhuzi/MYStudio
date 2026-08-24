import { describe, expect, it } from "vitest";
import {
  buildAssetFileUrl,
  buildProjectFileUrl,
  parseAssetFileUrl,
  parseProjectFileUrl,
} from "./project-file-url";

describe("project-file-url 全仓唯一拼装点", () => {
  it("buildProjectFileUrl 幂等:已是本项目虚拟路径原样返回,他项目抛错", () => {
    const url = buildProjectFileUrl("projX", "workflow-images/a/分镜-1.png");
    expect(url).toBe("project-file://projX/workflow-images/a/%E5%88%86%E9%95%9C-1.png");
    expect(buildProjectFileUrl("projX", url)).toBe(url);
    expect(() => buildProjectFileUrl("projY", url)).toThrow("其他项目");
  });

  it("buildAssetFileUrl 逐段编码,thumb 变体携带查询参数", () => {
    expect(buildAssetFileUrl("role/独孤剑尘_1.png")).toBe(
      "asset-file://role/%E7%8B%AC%E5%AD%A4%E5%89%91%E5%B0%98_1.png",
    );
    expect(buildAssetFileUrl("role/x.png", { thumb: true })).toBe("asset-file://role/x.png?thumb=1");
    expect(parseAssetFileUrl(buildAssetFileUrl("role/x.png", { thumb: true }))).toEqual({
      relativePath: "role/x.png",
      thumb: true,
    });
    expect(parseAssetFileUrl("asset-file://a/../../etc")).toBeNull();
    // 与 project-file 解析互不越界
    expect(parseProjectFileUrl("asset-file://role/x.png")).toBeNull();
  });
});
