// design-lint 单元与 CLI 测试(apple-hig-design-overhaul child1 交付)。
// 规则规格:.trellis/tasks/08-19-apple-hig-design-overhaul/design.md(design-lint 规则规格)。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { scanDesignViolations } from "../../build/scripts/design-lint.mjs";

const scriptPath = resolve(__dirname, "../../build/scripts/design-lint.mjs");
const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(resolve(tmpdir(), "design-lint-"));
  tempRoots.push(root);
  return root;
}

function writeFixture(root: string, relPath: string, content: string) {
  const abs = resolve(root, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("design-lint 规则扫描", () => {
  it("干净文件(纯语义 token)零发现", () => {
    const root = createTempRoot();
    writeFixture(
      root,
      "components/panels/demo/Clean.tsx",
      `export function Clean() {
        return <div className="rounded-2xl border border-border bg-card/50 p-5 text-sm text-muted-foreground backdrop-blur-xl" />;
      }`,
    );
    const result = scanDesignViolations({ root });
    expect(result.findings).toHaveLength(0);
    expect(result.totals).toEqual({ error: 0, warn: 0 });
  });

  it("R1/R2/R4/R5 各命中一次,含变体前缀", () => {
    const root = createTempRoot();
    writeFixture(
      root,
      "components/panels/demo/Dirty.tsx",
      `export function Dirty() {
        return (
          <div className="shadow-md bg-green-500/20 active:scale-95 text-white">
            <span className="dark:text-red-600">x</span>
          </div>
        );
      }`,
    );
    const result = scanDesignViolations({ root });
    const rules = result.findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["R1", "R2", "R2", "R4", "R5"]);
    const darkMatch = result.findings.find((f) => f.match === "dark:text-red-600");
    expect(darkMatch?.line).toBeGreaterThan(0);
  });

  it("R3:按钮语境渐变=error,装饰渐变=warn", () => {
    const root = createTempRoot();
    writeFixture(
      root,
      "components/panels/demo/Grad.tsx",
      `export function Grad() {
        return (
          <section>
            <Button className="bg-gradient-to-r from-amber-400 to-rose-500">go</Button>
            <div className="bg-gradient-to-br h-2" />
          </section>
        );
      }`,
    );
    const result = scanDesignViolations({ root });
    const gradients = result.findings.filter((f) => f.rule === "R3");
    expect(gradients).toHaveLength(2);
    expect(gradients.filter((f) => f.severity === "error")).toHaveLength(1);
    expect(gradients.filter((f) => f.severity === "warn")).toHaveLength(1);
    // from-amber-400/to-rose-500 也是 R2 命中
    expect(result.findings.some((f) => f.rule === "R2" && f.match === "from-amber-400")).toBe(true);
  });

  it("白名单:弹层路径跳过,chrome 原语降级 warn", () => {
    const root = createTempRoot();
    writeFixture(root, "components/ui/dialog.tsx", `export const x = <div className="shadow-lg bg-blue-500" />;`);
    writeFixture(root, "components/ui/sidebar.tsx", `export const y = <div className="shadow-md" />;`);
    const result = scanDesignViolations({ root });
    expect(result.findings.filter((f) => f.file === "components/ui/dialog.tsx")).toHaveLength(0);
    const sidebar = result.findings.find((f) => f.file === "components/ui/sidebar.tsx");
    expect(sidebar?.severity).toBe("warn");
  });

  it("测试文件与 node_modules 不扫描", () => {
    const root = createTempRoot();
    writeFixture(root, "components/x.test.tsx", `export const a = <div className="shadow-sm" />;`);
    writeFixture(root, "node_modules/pkg/y.tsx", `export const b = <div className="shadow-sm" />;`);
    const result = scanDesignViolations({ root });
    expect(result.findings).toHaveLength(0);
  });
});

describe("design-lint CLI", () => {
  it("违规文件退出码 1,干净文件退出码 0", () => {
    const root = createTempRoot();
    const dirty = writeFixture(root, "Bad.tsx", `export const a = <div className="shadow-sm" />;`);
    const clean = writeFixture(root, "Good.tsx", `export const b = <div className="bg-card" />;`);

    const bad = spawnSync(process.execPath, [scriptPath, "--root", root, "--files", dirty], {
      encoding: "utf8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("error 1");

    const good = spawnSync(process.execPath, [scriptPath, "--root", root, "--files", clean], {
      encoding: "utf8",
    });
    expect(good.status).toBe(0);
  });
});
