// @vitest-environment jsdom
// design 原语测试(apple-hig-design-overhaul child2):StatusPill/IconTile/PanelHeader
// 与 Card glass / Alert warning 变体(design-spec.md 的代码级锚点)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Music2, TriangleAlert } from "lucide-react";
import { StatusPill } from "./status-pill";
import { IconTile } from "./icon-tile";
import { PanelHeader } from "./panel-header";
import { Card } from "./card";
import { Alert } from "./alert";
import { Button, buttonVariants } from "./button";

afterEach(cleanup);

describe("Button paid 变体(付费云端生成 CTA,design-spec §4 裁定 2026-08-25)", () => {
  it("paid=金色淡描边,专属付费语义且非实心", () => {
    const { container } = render(<Button variant="paid">生成</Button>);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("border-primary/30");
    expect(btn?.className).toContain("bg-primary/10");
    expect(btn?.className).toContain("text-primary/80");
    expect(btn?.className).toContain("hover:bg-primary/18");
    expect(btn?.className).not.toContain("bg-primary ");
  });

  it("buttonVariants 暴露 paid 供 AlertDialogAction 等非 Button 载体复用", () => {
    expect(buttonVariants({ variant: "paid" })).toContain("border-primary/30");
  });
});

describe("StatusPill(状态胶囊四态)", () => {
  it("ready:success 着色+呼吸点+默认文案", () => {
    const { container } = render(<StatusPill state="ready" />);
    const pill = container.querySelector("span");
    expect(pill?.className).toContain("border-success/25");
    expect(pill?.innerHTML).toContain("motion-safe:animate-ping");
    expect(pill?.textContent).toContain("就绪");
  });

  it("missing:destructive 着色;checking:spinner+弱化;unknown:纯弱化", () => {
    const { container: c1 } = render(<StatusPill state="missing" />);
    expect(c1.querySelector("span")?.className).toContain("border-destructive/25");
    const { container: c2 } = render(<StatusPill state="checking" />);
    expect(c2.querySelector("svg")).toBeTruthy();
    const { container: c3 } = render(<StatusPill state="unknown" />);
    expect(c3.querySelector("span")?.className).toContain("text-muted-foreground");
  });

  it("label 覆盖默认文案(母版迁移场景)", () => {
    render(<StatusPill state="ready" label="引擎就绪" />);
    expect(screen.getByText("引擎就绪")).toBeTruthy();
  });
});

describe("IconTile(着色图标瓦)", () => {
  it("md=页头瓦尺寸,primary 着色,图标可访问性隐藏", () => {
    const { container } = render(<IconTile icon={Music2} />);
    const tile = container.querySelector("div");
    expect(tile?.className).toContain("h-11");
    expect(tile?.className).toContain("bg-primary/10");
    expect(tile?.querySelector("svg[aria-hidden]")).toBeTruthy();
  });

  it("sm+warning=警示圆徽尺寸与着色", () => {
    const { container } = render(<IconTile icon={TriangleAlert} size="sm" tone="warning" />);
    const tile = container.querySelector("div");
    expect(tile?.className).toContain("h-9");
    expect(tile?.className).toContain("bg-warning/10");
  });
});

describe("PanelHeader(面板页头)", () => {
  it("overline+大标题+徽位结构", () => {
    render(
      <PanelHeader
        icon={Music2}
        overline="MiniMax-Music3 · bf16 本地引擎"
        title="为《道劫》生成音乐"
        badge={<StatusPill state="ready" label="引擎就绪" />}
      />,
    );
    expect(screen.getByText("MiniMax-Music3 · bf16 本地引擎")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "为《道劫》生成音乐" })).toBeTruthy();
    expect(screen.getByText("引擎就绪")).toBeTruthy();
  });
});

describe("Card glass 变体(增量,默认行为不变)", () => {
  it("默认 solid:不出现玻璃类", () => {
    const { container } = render(<Card>内容</Card>);
    expect(container.querySelector("div")?.className).not.toContain("tts-glass-card");
  });

  it("glass:玻璃材质类齐备", () => {
    const { container } = render(<Card variant="glass">内容</Card>);
    const cls = container.querySelector("div")?.className ?? "";
    expect(cls).toContain("tts-glass-card");
    expect(cls).toContain("bg-card/50");
    expect(cls).toContain("backdrop-blur-xl");
  });
});

describe("Alert warning 变体", () => {
  it("warning 材质类齐备", () => {
    const { container } = render(<Alert variant="warning">引擎未就绪</Alert>);
    const cls = container.querySelector("div")?.className ?? "";
    expect(cls).toContain("border-warning/25");
    expect(cls).toContain("bg-warning/[0.06]");
    expect(cls).toContain("backdrop-blur-xl");
  });
});
