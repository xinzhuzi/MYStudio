// design-lint 全仓门禁(apple-hig-design-overhaul 收官护栏):
// npm test 即校验全前端 error=0——任何新硬编码色/阴影/纯白前景直接红测,
// 不再依赖人肉记得跑 design-lint。warn 不设断言(豁免项=覆盖层白字/装饰渐变,
// 见 design-lint-whitelist.json)。
import { describe, expect, it } from "vitest";
import { scanDesignViolations } from "../../build/scripts/design-lint.mjs";
import { resolve } from "node:path";

describe("design-lint 全仓门禁", () => {
  it("前端源码违规 error=0(白名单外;新违规请修代码或走裁定进白名单)", () => {
    const result = scanDesignViolations({
      root: resolve(__dirname, "../"),
    });
    const errors = result.findings.filter((f) => f.severity === "error");
    if (errors.length > 0) {
      const summary = errors
        .slice(0, 10)
        .map((f) => `${f.file}:${f.line} ${f.match}`)
        .join("\n  ");
      throw new Error(
        `design-lint error ${errors.length} 处(规范=.trellis/spec/frontend/design-spec.md):\n  ${summary}${errors.length > 10 ? "\n  …" : ""}`,
      );
    }
    expect(errors).toHaveLength(0);
  });
});
