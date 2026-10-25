// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ImageIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAssetDetailPreviewPane } from "./studio-asset-detail-preview-pane";
import type { StudioAssetSummary } from "@/types/studio-assets";

// 批3「按型出图」下拉:Radix 交互属原语自件不重测,本文件按仓惯例
// (panels/media/index.test.tsx 同款)打桩为直通件——断言菜单项装配契约。
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    className,
    onClick,
    disabled,
  }: { children: ReactNode; className?: string; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("IntersectionObserver", class {
    root = null;
    rootMargin = "0px";
    thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

type PreviewPaneProps = ComponentProps<typeof StudioAssetDetailPreviewPane>;

function asset(overrides: Partial<StudioAssetSummary> = {}): StudioAssetSummary {
  return {
    id: "asset-1",
    source: "manying-local",
    type: "role",
    name: "主角",
    ...overrides,
  };
}

function makeProps(overrides: Partial<PreviewPaneProps> = {}): PreviewPaneProps {
  return {
    asset: asset(),
    images: [
      { name: "主图", filePath: "role/main.png", url: "media://main" },
      { name: "姿态一", filePath: "role/pose.png", url: "media://pose" },
    ],
    currentIndex: 0,
    spokenText: "",
    audioSrc: "",
    Icon: ImageIcon,
    onSelectImage: vi.fn(),
    onImageClick: vi.fn(),
    onTranscribe: vi.fn(),
    onRemoveImage: vi.fn(),
    onFaceFromImage: vi.fn(),
    onFaceFromText: vi.fn(),
    onExpression: vi.fn(),
    ...overrides,
  };
}

function renderPane(overrides: Partial<PreviewPaneProps> = {}) {
  const props = makeProps(overrides);
  const view = render(<StudioAssetDetailPreviewPane {...props} />);
  return { ...view, props };
}

/** 节头序(grill Round 1 裁定2:身份链根→常规产物→重版式→工具型→兜底)。 */
const ROLE_SECTION_ORDER = [
  "无衣物定妆",
  "人物海报",
  "人物多视图",
  "高清人脸",
  "表情差分",
  "设定卡",
  "美宣",
  "人脸基准",
  "自由",
];

describe("StudioAssetDetailPreviewPane · 10-24 布局重造批1(图片规范区骨架)", () => {
  it("renders the audio playback card unchanged and delegates transcription (#18 audio 轨零动)", () => {
    const { container, props } = renderPane({
      asset: asset({ type: "audio", name: "旁白.wav" }),
      images: [],
      spokenText: "山雨将至。",
      audioSrc: "media://voice.wav",
    });

    expect(screen.getByText("山雨将至。")).toBeTruthy();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("media://voice.wav");
    fireEvent.click(screen.getByRole("button", { name: "✨ 智能生成说话内容" }));
    expect(props.onTranscribe).toHaveBeenCalledTimes(1);
    // 图片规范区不进 audio 轨
    expect(screen.queryByRole("region", { name: "图片" })).toBeNull();
    expect(screen.queryByRole("button", { name: "添加图片" })).toBeNull();
  });

  it("shows the audio empty state when no playable source exists", () => {
    renderPane({ asset: asset({ type: "audio" }), images: [] });

    expect(screen.getByText("暂无口播词句")).toBeTruthy();
    expect(screen.getByText("暂无可播放的音频地址")).toBeTruthy();
  });

  it("renders the ten role sections in the ruling order with aspect badges and counts", () => {
    renderPane({ canFacePortrait: true });

    const sectionNames = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(sectionNames).toEqual(ROLE_SECTION_ORDER);

    // 节头画幅徽标(3:4/16:9/1:1)+计数
    const fullBodySection = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(fullBodySection).getByText("3:4")).toBeTruthy();
    expect(within(fullBodySection).getByText("0 张")).toBeTruthy();
    const multiViewSection = screen.getByRole("region", { name: "人物多视图" });
    expect(within(multiViewSection).getByText("16:9")).toBeTruthy();
    const faceSection = screen.getByRole("region", { name: "高清人脸" });
    expect(within(faceSection).getByText("1:1")).toBeTruthy();
    // 10-25 裁定:无标记图落自由节(三层解析兜底)
    const uncategorized = screen.getByRole("region", { name: "自由" });
    expect(within(uncategorized).getByText("2 张")).toBeTruthy();
    expect(within(uncategorized).getByRole("img", { name: "主图" }).getAttribute("src")).toBe("media://main");
    expect(within(uncategorized).getByRole("img", { name: "姿态一" }).getAttribute("src")).toBe("media://pose");
  });

  it("renders dashed placeholder cards for every empty typed section (空型槽位恒在)", () => {
    renderPane({ images: [] });

    for (const kind of ROLE_SECTION_ORDER.slice(0, 8)) {
      const section = screen.getByRole("region", { name: kind });
      expect(within(section).getByText(`尚无${kind}`)).toBeTruthy();
      expect(section.querySelector(".studio-asset-image-placeholder")).toBeTruthy();
    }
    // 自由节(第 9)占位卡同样恒在(占位文本随渲染器形态,断 placeholder 类)
    const free = screen.getByRole("region", { name: "自由" });
    expect(free.querySelector(".studio-asset-image-placeholder")).toBeTruthy();
  });

  it("renders the completeness overview bar above typed-track galleries(Round 3 ⑤ 三轨通用;clip 无)", () => {
    const { container } = renderPane();
    expect(screen.getByText("图片规范完整度")).toBeTruthy();
    expect(container.querySelector(".studio-asset-completeness-bar")).toBeTruthy();

    // scene/tool 同款完整度条(型谱分节画廊);clip 无型谱零侵入
    cleanup();
    renderPane({ asset: asset({ type: "scene" }) });
    expect(screen.getByText("图片规范完整度")).toBeTruthy();
    cleanup();
    renderPane({ asset: asset({ type: "tool" }) });
    expect(screen.getByText("图片规范完整度")).toBeTruthy();
    cleanup();
    renderPane({ asset: asset({ type: "clip" }) });
    expect(screen.queryByText("图片规范完整度")).toBeNull();
  });

  it("lays each section out as a horizontally scrolling card row", () => {
    const { container } = renderPane();
    const rows = container.querySelectorAll(".studio-asset-image-row");
    expect(rows.length).toBe(ROLE_SECTION_ORDER.length);
    for (const row of rows) {
      expect(row.className).toContain("overflow-x-auto");
    }
  });

  it("selects a card on click and highlights the current selection with a ring", () => {
    const { props, rerender } = renderPane();

    fireEvent.click(screen.getByRole("button", { name: "选中图片 姿态一" }));
    expect(props.onSelectImage).toHaveBeenCalledWith(1);

    // currentIndex=1 → 姿态一 卡 ring 高亮,主图卡无
    rerender(<StudioAssetDetailPreviewPane {...props} currentIndex={1} />);
    const poseCard = screen.getByRole("img", { name: "姿态一" }).closest(".studio-asset-image-card");
    const mainCard = screen.getByRole("img", { name: "主图" }).closest(".studio-asset-image-card");
    expect(poseCard?.className).toContain("ring-2");
    expect(poseCard?.className).toContain("ring-primary");
    expect(mainCard?.className).not.toContain("ring-2");
    // 10-25 用户令:工具行移除,全局选中图指示随之退役(选中 ring 仍生效)
  });

  it("keeps the card hover actions: full preview (#19) and remove (#11) with exact image+index", () => {
    const { props } = renderPane();

    fireEvent.click(screen.getByRole("button", { name: "全屏预览 姿态一" }));
    expect(props.onImageClick).toHaveBeenCalledWith(1);
    // 复审 M1:更换图片不进卡悬浮(回调恒换当前行主图,按卡点名误导)——卡悬浮只剩放大/删图
    expect(screen.queryByRole("button", { name: /更换图片 / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "删除图片 姿态一" }));
    expect(props.onRemoveImage).toHaveBeenCalledWith(props.images[1], 1);
    fireEvent.click(screen.getByRole("button", { name: "删除图片 主图" }));
    expect(props.onRemoveImage).toHaveBeenCalledWith(props.images[0], 0);
  });

  it("honors the injected isImageRemovable predicate for family read-only entries", () => {
    renderPane({ isImageRemovable: (_image, index) => index !== 0 });

    // 注入判定优先:第 0 条(族兄弟只读位)不显示删除钮,第 1 条显示
    expect(screen.getAllByRole("button", { name: /删除图片/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "删除图片 姿态一" }));
  });

  it("工具行整体移除(10-25 用户令):七个旧工具钮+选中尾注不再渲染", () => {
    renderPane();
    for (const name of ["重新出图", "复制出图提示词", "查看图片", "打开本地文件夹", "添加图片", "更换图片", "未选中图片"]) {
      expect(screen.queryByText(name)).toBeNull();
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /图生图/ })).toBeNull();
  });

  it("renders the role zero-image skeleton: typed placeholders 全节(无未分类节,10-25 无类型图归自由)", () => {
    renderPane({ images: [] });

    expect(screen.getAllByText(/尚无/).length).toBeGreaterThanOrEqual(9); // 九型占位全在
  });





  // 10-21 高清人脸:两路按钮迁居「高清人脸」节头(守卫/相位文案零变)
  it("hides the face portrait buttons by default and shows them in the 高清人脸 section header for role assets", () => {
    const hidden = renderPane();
    expect(hidden.queryByRole("button", { name: /人脸·图生图/ })).toBeNull();
    expect(hidden.queryByRole("button", { name: /人脸·文生图/ })).toBeNull();

    cleanup();
    const { props } = renderPane({ canFacePortrait: true });
    const faceSection = screen.getByRole("region", { name: "高清人脸" });
    fireEvent.click(within(faceSection).getByRole("button", { name: "人脸·图生图" }));
    fireEvent.click(within(faceSection).getByRole("button", { name: "人脸·文生图" }));
    expect(props.onFaceFromImage).toHaveBeenCalledTimes(1);
    expect(props.onFaceFromText).toHaveBeenCalledTimes(1);
  });

  it("disables face-from-image without images but keeps face-from-text available", () => {
    renderPane({ canFacePortrait: true, images: [] });

    const faceSection = screen.getByRole("region", { name: "高清人脸" });
    const fromImage = within(faceSection).getByRole("button", { name: "人脸·图生图" }) as HTMLButtonElement;
    expect(fromImage.disabled).toBe(true);
    expect(fromImage.getAttribute("title")).toContain("先有角色图片");
    const fromText = within(faceSection).getByRole("button", { name: "人脸·文生图" }) as HTMLButtonElement;
    expect(fromText.disabled).toBe(false);
  });

  it("shows the spinner and phase text while a face portrait is running", () => {
    renderPane({ canFacePortrait: true, facePhase: "generating", faceMessage: "正在生成 主角 的高清人脸(图生图)..." });

    const faceSection = screen.getByRole("region", { name: "高清人脸" });
    const buttons = within(faceSection).getAllByRole("button", { name: /人脸生成中/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.querySelector(".animate-spin")).toBeTruthy();
    }
    expect(within(faceSection).getAllByText("人脸生成中…")).toHaveLength(2);
  });

  it("disables both face portrait entries while generation or style transfer is running", () => {
    renderPane({ canFacePortrait: true, generatePhase: "generating" });

    const faceSection = screen.getByRole("region", { name: "高清人脸" });
    for (const label of ["人脸·图生图", "人脸·文生图"]) {
      const button = within(faceSection).getByRole("button", { name: label }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("title")).toBeTruthy();
    }
  });

  // 10-21 表情差分:按钮迁居「表情差分」节头(守卫/相位文案零变)
  it("hides the expression sheet button by default and fires it from the 表情差分 section header", () => {
    const hidden = renderPane();
    expect(hidden.queryByRole("button", { name: "表情差分" })).toBeNull();

    cleanup();
    const { props } = renderPane({ canFacePortrait: true });
    const expressionSection = screen.getByRole("region", { name: "表情差分" });
    fireEvent.click(within(expressionSection).getByRole("button", { name: "表情差分" }));
    expect(props.onExpression).toHaveBeenCalledTimes(1);
  });

  it("disables the expression sheet button without images", () => {
    renderPane({ canFacePortrait: true, images: [] });

    const expressionSection = screen.getByRole("region", { name: "表情差分" });
    const button = within(expressionSection).getByRole("button", { name: "表情差分" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toContain("先有角色图片");
  });

  it("shows the spinner and phase text while an expression sheet is running", () => {
    renderPane({ canFacePortrait: true, expressionPhase: "generating", expressionMessage: "正在生成 主角 的表情差分..." });

    const expressionSection = screen.getByRole("region", { name: "表情差分" });
    const button = within(expressionSection).getByRole("button", { name: "表情差分生成中…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".animate-spin")).toBeTruthy();
  });

  it("disables the expression sheet entry while face portrait is running", () => {
    renderPane({ canFacePortrait: true, facePhase: "generating" });
    const expressionSection = screen.getByRole("region", { name: "表情差分" });
    const button = within(expressionSection).getByRole("button", { name: "表情差分" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBeTruthy();
  });

  // Round 3 扩展令⑤后:仅 clip 无型谱=单节「图片」横向行(scene/tool 已升型谱分节)
  it("renders a single 图片 section for clip assets without typed sections or the completeness bar", () => {
    renderPane({ asset: asset({ type: "clip", name: "clip资产" }) });

    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["图片"]);
    expect(screen.queryByText("图片规范完整度")).toBeNull();
    const single = screen.getByRole("region", { name: "图片" });
    expect(within(single).getByRole("img", { name: "主图" })).toBeTruthy();
    expect(within(single).getByText("2 张")).toBeTruthy();
    // 非 role 轨零人脸/表情差分侵入(canFacePortrait 缺省 false)
    expect(screen.queryByRole("button", { name: /人脸·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "表情差分" })).toBeNull();
  });

  it("keeps the empty non-audio preview reachable for clip assets (工具行+尚无图片占位)", () => {
    renderPane({ asset: asset({ type: "clip", name: "片段一" }), images: [] });

    expect(screen.getByText("尚无图片")).toBeTruthy();
    expect(screen.queryByRole("video")).toBeNull();
    // 10-25 用户令:工具行移除后 clip 单节区不再带旧工具钮
    expect(screen.queryByRole("button", { name: "添加图片" })).toBeNull();
    expect(screen.queryByRole("button", { name: "更换图片" })).toBeNull();
  });
});

describe("StudioAssetDetailPreviewPane · 10-24 批2(分类归节+完整度总览条+占位卡 CTA)", () => {
  /** 晏燎十境四型抽样+无标记图:分组归节/计数/徽标/完整度统计共用样本。 */
  const TYPED_IMAGES = [
    { name: "晏燎_练气期_三视图_v1", filePath: "role/a1.png", url: "media://a1" },
    { name: "晏燎_练气期_正视图_v1", filePath: "role/a2.png", url: "media://a2" },
    { name: "晏燎_练气期_人物海报_v1", filePath: "role/a6.png", url: "media://a6" },
    { name: "晏燎_练气期_海报_v1", filePath: "role/a3.png", url: "media://a3" },
    { name: "晏燎_练气期_高清大脸_2026年10月21日", filePath: "role/a4.png", url: "media://a4" },
    { name: "主图", filePath: "role/a5.png", url: "media://a5" },
  ];

  it("按命名分类归节:四型各 1 张落对应节,无标记沉自由(10-25 裁定)", () => {
    renderPane({ images: TYPED_IMAGES });

    const multi = screen.getByRole("region", { name: "人物多视图" });
    expect(within(multi).getByText("2 张")).toBeTruthy();
    expect(within(multi).getByRole("img", { name: "晏燎_练气期_三视图_v1" })).toBeTruthy();
    // 10-25 裁定:正视图(全身立绘参考图)并入人物多视图节
    expect(within(multi).getByRole("img", { name: "晏燎_练气期_正视图_v1" })).toBeTruthy();
    const poster = screen.getByRole("region", { name: "人物海报" });
    expect(within(poster).getByRole("img", { name: "晏燎_练气期_人物海报_v1" })).toBeTruthy();
    // 10-25 二令:_海报_ 海报产物归人物海报(美宣节只收 _美宣_ 命名)
    expect(within(poster).getByRole("img", { name: "晏燎_练气期_海报_v1" })).toBeTruthy();
    expect(within(poster).getByText("2 张")).toBeTruthy();
    const face = screen.getByRole("region", { name: "高清人脸" });
    expect(within(face).getByText("1 张")).toBeTruthy();
    const uncategorized = screen.getByRole("region", { name: "自由" });
    expect(within(uncategorized).getByText("1 张")).toBeTruthy();
    expect(within(uncategorized).getByRole("img", { name: "主图" })).toBeTruthy();
  });

  it("持久 kind 压过命名:改名图按 kind 归节(视图模型 kind 落值消费)", () => {
    renderPane({
      images: [
        { name: "随手改的名", filePath: "role/b1.png", url: "media://b1", kind: "美宣" as const },
      ],
    });

    const promo = screen.getByRole("region", { name: "美宣" });
    expect(within(promo).getByRole("img", { name: "随手改的名" })).toBeTruthy();
    expect(within(promo).getByText("1 张")).toBeTruthy();
  });

  it("图卡不带型徽标(10-26 用户令:图片分类类型提示不要)", () => {
    renderPane({ images: TYPED_IMAGES });
    // 图卡上不再叠类型小标签(节头与完整度已有型信息,卡面保持干净)
    for (const image of TYPED_IMAGES) {
      const card = screen.getByRole("img", { name: image.name }).closest(".studio-asset-image-card");
      // 判独立徽标元素而非子串(文件名本身含型名,子串断言会误中)
      const kindBadge = card?.querySelector("span.pointer-events-none.absolute.left-1.top-1");
      expect(kindBadge).toBeNull();
    }
  });

  it("核心型空节:节头红点+占位卡红角标+CTA 直达生成;扩展型灰占不告警", () => {
    const { props } = renderPane({ images: TYPED_IMAGES, onGenerateByKind: vi.fn() });

    // 无衣物定妆(核心)空节:红点+缺角标+CTA 点发
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(fullBody).getByLabelText("无衣物定妆缺失")).toBeTruthy();
    expect(within(fullBody).getByText("缺")).toBeTruthy();
    fireEvent.click(within(fullBody).getByRole("button", { name: "点击生成" }));
    expect(props.onGenerateByKind).toHaveBeenCalledWith("无衣物定妆");

    // 设定卡(扩展)空节:无红点无缺角标;CTA 仍直达(灰占不告警≠不可生成)
    const settingCard = screen.getByRole("region", { name: "设定卡" });
    expect(within(settingCard).queryByLabelText("设定卡缺失")).toBeNull();
    expect(within(settingCard).queryByText("缺")).toBeNull();
    fireEvent.click(within(settingCard).getByRole("button", { name: "点击生成" }));
    expect(props.onGenerateByKind).toHaveBeenCalledWith("设定卡");

    // 高清人脸(核心)有图:无红点
    const face = screen.getByRole("region", { name: "高清人脸" });
    expect(within(face).queryByLabelText("高清人脸缺失")).toBeNull();
  });

  it("完整度总览条两行分级:核心缺失红 chip 可点直达,已齐 ✓n;扩展行灰占;一键补缺队列钮接线(批3)", () => {
    const fillMissing = vi.fn();
    const { props, container } = renderPane({ images: TYPED_IMAGES, onGenerateByKind: vi.fn(), onFillMissing: fillMissing });

    // 核心行:多视图/海报/人脸已齐 ✓(海报=人物海报+海报双标记载体 ✓2);无衣物定妆/表情差分缺失红 chip 可点
    expect(screen.getByText("人物多视图 ✓2")).toBeTruthy();
    expect(screen.getByText("人物海报 ✓2")).toBeTruthy();
    expect(screen.getByText("高清人脸 ✓1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "无衣物定妆 ✗" }));
    expect(props.onGenerateByKind).toHaveBeenCalledWith("无衣物定妆");
    fireEvent.click(screen.getByRole("button", { name: "表情差分 ✗" }));
    expect(props.onGenerateByKind).toHaveBeenCalledWith("表情差分");

    // 扩展行:四型灰占(设定卡 —),非交互
    expect(screen.getByText("设定卡 —")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "设定卡 —" })).toBeNull();

    // 批3 一键补缺队列钮:缺失核心型在场即启用,点击派发队列入口
    const fillAll = screen.getByRole("button", { name: "一键补缺" }) as HTMLButtonElement;
    expect(fillAll.disabled).toBe(false);
    expect(fillAll.getAttribute("title")).toContain("2 类核心图");
    fireEvent.click(fillAll);
    expect(fillMissing).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".studio-asset-completeness-bar")).toBeTruthy();
  });

  it("onGenerateByKind 缺席时占位卡退回纯示位(老调用方零侵入)", () => {
    renderPane({ images: TYPED_IMAGES });

    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(fullBody).getByText("尚无无衣物定妆")).toBeTruthy();
    expect(within(fullBody).queryByRole("button", { name: "点击生成" })).toBeNull();
  });
});

describe("StudioAssetDetailPreviewPane · 10-24 批3(按型出图按钮族:节头钮+下拉+一键补缺队列)", () => {
  /** 按型出图七型(型档案节序)。 */
  const SHOT_KINDS = ["无衣物定妆", "人物海报", "人物多视图", "人脸基准", "自由", "设定卡", "美宣"] as const;

  it("节头生成钮:缺省隐藏,canTypeShot 时七型各带「生成{型名}」钮,点击派发型名", () => {
    const hidden = renderPane({ images: [] });
    expect(hidden.queryByRole("button", { name: "生成无衣物定妆" })).toBeNull();
    expect(hidden.queryByRole("button", { name: "生成设定卡" })).toBeNull();

    cleanup();
    // 有参考图(i2i 五型可点;无标记图归自由节零干扰(10-25))
    const onTypeShot = vi.fn();
    renderPane({
      images: [{ name: "主图", filePath: "role/main.png", url: "media://main" }],
      canTypeShot: true,
      onTypeShot,
    });
    for (const kind of SHOT_KINDS) {
      fireEvent.click(screen.getByRole("button", { name: `生成${kind}` }));
    }
    expect(onTypeShot.mock.calls.map(([kind]) => kind)).toEqual([...SHOT_KINDS]);
    // 既有路节(高清人脸/表情差分)恒无型驱动钮(候 Phase 2 收编)
    expect(screen.queryByRole("button", { name: "生成高清人脸" })).toBeNull();
    expect(screen.queryByRole("button", { name: "生成表情差分" })).toBeNull();
  });

  it("节头钮 gating:i2i 型零图禁用(title 提示),t2i 型(设定卡/美宣)零图可点", () => {
    renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn() });

    // 10-25 用户令:无衣物定妆 t2i 化——零图可点(主体句+型层承载,无参考图门槛)
    const fullBody = screen.getByRole("button", { name: "生成无衣物定妆" }) as HTMLButtonElement;
    expect(fullBody.disabled).toBe(false);
    const poster = screen.getByRole("button", { name: "生成人物海报" }) as HTMLButtonElement;
    expect(poster.disabled).toBe(true);
    const sheet = screen.getByRole("button", { name: "生成设定卡" }) as HTMLButtonElement;
    expect(sheet.disabled).toBe(false);
    const promo = screen.getByRole("button", { name: "生成美宣" }) as HTMLButtonElement;
    expect(promo.disabled).toBe(false);
  });

  it("节头钮相位:typeShotPhase 在跑全族 Loader2+禁点(第五路互斥家族扩容)", () => {
    renderPane({
      images: [{ name: "主图", filePath: "role/main.png", url: "media://main" }],
      canTypeShot: true,
      canFacePortrait: true,
      onTypeShot: vi.fn(),
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });

    // 七型节头钮全部转「生成中…」相位:禁点+Loader2+相位文案进 title
    const runningButtons = screen.getAllByRole("button", { name: "生成中…" }) as HTMLButtonElement[];
    expect(runningButtons).toHaveLength(SHOT_KINDS.length);
    for (const button of runningButtons) {
      expect(button.disabled).toBe(true);
      expect(button.querySelector(".animate-spin")).toBeTruthy();
      expect(button.getAttribute("title")).toContain("无衣物定妆");
    }
    // 互斥家族随动:人脸双钮/表情差分/一键补缺全禁(10-25 工具行移除,图生图钮退役)
    const faceSection = screen.getByRole("region", { name: "高清人脸" });
    expect((within(faceSection).getByRole("button", { name: "人脸·图生图" }) as HTMLButtonElement).disabled).toBe(true);
    const expressionSection = screen.getByRole("region", { name: "表情差分" });
    expect((within(expressionSection).getByRole("button", { name: "表情差分" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "一键补缺" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("「按型出图」下拉:缺省隐藏,canTypeShot 时七型菜单项带画幅/透明徽标,点击派发型名", () => {
    const hidden = renderPane({ images: [] });
    expect(hidden.queryByRole("button", { name: /按型出图/ })).toBeNull();

    cleanup();
    const { props } = renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn() });
    const trigger = screen.getByRole("button", { name: /按型出图/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);

    // 菜单项(打桩直通渲染):七型各一项,画幅徽标齐,透明徽标按型档案(无衣物定妆=透明/美宣=无)
    const menu = document.querySelector(".studio-asset-typeshot-menu");
    expect(menu).toBeTruthy();
    const menuScope = within(menu as HTMLElement);
    const items = Array.from(menu?.querySelectorAll(".studio-asset-typeshot-item") ?? []);
    expect(items.map((item) => item.textContent?.replace(/3:4|16:9|1:1|透明/g, "").trim()))
      .toEqual([...SHOT_KINDS]);
    const fullBodyItem = menuScope.getByRole("button", { name: /无衣物定妆/ });
    expect(fullBodyItem.textContent).toContain("3:4");
    expect(fullBodyItem.textContent).toContain("透明");
    const promoItem = menuScope.getByRole("button", { name: /美宣/ });
    expect(promoItem.textContent).toContain("16:9");
    expect(promoItem.textContent).not.toContain("透明");

    fireEvent.click(menuScope.getByRole("button", { name: /人物多视图/ }));
    expect(props.onTypeShot).toHaveBeenCalledWith("人物多视图");
  });

  it("非图片三轨零侵入:clip 单节无节头生成钮/无下拉/无补缺钮(裁定 D 余量)", () => {
    renderPane({
      asset: asset({ type: "clip" }),
      images: [{ name: "片段一", filePath: "clip/c1.png", url: "media://c1" }],
      canTypeShot: true,
      onTypeShot: vi.fn(),
      onFillMissing: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: /按型出图/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "一键补缺" })).toBeNull();
    expect(screen.queryByRole("button", { name: /生成无衣物定妆/ })).toBeNull();
  });

  it("Round 3 ⑤ scene 轨型谱:三型分节+自由+未分类沉底,完整度三核心两行分级,存量图命名归位", () => {
    renderPane({
      asset: asset({ type: "scene", name: "山门" }),
      images: [{ name: "山门_场景_v1", filePath: "scene/s1.png", url: "media://s1" }],
    });

    // 节序=scene 谱:场景→概念气氛图→3D剖面场景图→自由(10-25 无未分类节,无类型图落自由)
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "场景", "概念气氛图", "3D剖面场景图", "自由",
    ]);
    expect(screen.getByText("图片规范完整度")).toBeTruthy();
    const sceneSection = screen.getByRole("region", { name: "场景" });
    expect(within(sceneSection).getByText("1 张")).toBeTruthy();
    // 核心行=三核心(场景 ✓1 已齐;概念气氛图/3D剖面 缺失红态);扩展行=自由灰占
    expect(screen.getByText("场景 ✓1")).toBeTruthy();
    expect(screen.getByText("概念气氛图 ✗")).toBeTruthy();
    expect(screen.getByText("3D剖面场景图 ✗")).toBeTruthy();
    expect(screen.getByText("自由 —")).toBeTruthy();
    // 核心空节红点+占位卡红角标(同款两行分级)
    expect(within(sceneSection).queryByLabelText("场景缺失")).toBeNull();
    const concept = screen.getByRole("region", { name: "概念气氛图" });
    expect(within(concept).getByLabelText("概念气氛图缺失")).toBeTruthy();
    expect(within(concept).getByText("缺")).toBeTruthy();
  });

  it("Round 3 ⑤ tool 轨型谱:道具节(透明型 t2i 零图可点)+自由;下拉/节头钮按轨取谱", () => {
    const onTypeShot = vi.fn();
    renderPane({
      asset: asset({ type: "tool", name: "玄铁剑" }),
      images: [],
      canTypeShot: true,
      onTypeShot,
      onFillMissing: vi.fn(),
    });

    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "道具", "自由",
    ]);
    // 道具=t2i 透明底型:零图可点(无参考需求);节头带透明+t2i 徽标
    const propButton = screen.getByRole("button", { name: "生成道具" }) as HTMLButtonElement;
    expect(propButton.disabled).toBe(false);
    const propSection = screen.getByRole("region", { name: "道具" });
    expect(within(propSection).getAllByText("透明").length).toBeGreaterThanOrEqual(1);
    expect(within(propSection).getByText("t2i")).toBeTruthy();
    // 下拉按轨取谱=tool 两项(自由+道具,型档案序)
    const menu = document.querySelector(".studio-asset-typeshot-menu");
    const items = Array.from(menu?.querySelectorAll(".studio-asset-typeshot-item") ?? []);
    expect(items.map((item) => item.textContent?.replace(/3:4|16:9|1:1|透明/g, "").trim()))
      .toEqual(["自由", "道具"]);
    // role 型谱项零泄漏(scene/tool 下拉不含 role 七型)
    expect(screen.queryByRole("button", { name: /生成无衣物定妆/ })).toBeNull();
    // 完整度核心=道具一核心;一键补缺在位
    expect(screen.getByText("道具 ✗")).toBeTruthy();
    expect(screen.getByRole("button", { name: "一键补缺" })).toBeTruthy();
  });

  it("Round 3 ⑤ scene 轨生成钮:i2i 型零图禁用 title=先有场景图片;下拉按轨四型", () => {
    const onTypeShot = vi.fn();
    renderPane({
      asset: asset({ type: "scene", name: "山门" }),
      images: [],
      canTypeShot: true,
      onTypeShot,
      onFillMissing: vi.fn(),
    });

    const sceneButton = screen.getByRole("button", { name: "生成场景" }) as HTMLButtonElement;
    expect(sceneButton.disabled).toBe(true);
    expect(sceneButton.getAttribute("title")).toContain("先有场景图片");
    const menu = document.querySelector(".studio-asset-typeshot-menu");
    const items = Array.from(menu?.querySelectorAll(".studio-asset-typeshot-item") ?? []);
    expect(items.map((item) => item.textContent?.replace(/3:4|16:9|1:1|透明/g, "").trim()))
      .toEqual(["自由", "场景", "概念气氛图", "3D剖面场景图"]);
    fireEvent.click(sceneButton);
    expect(onTypeShot).not.toHaveBeenCalled();
  });

  it("一键补缺队列钮:五必备全齐禁用(title 已齐);busy 禁用;队列进度文案透出", () => {
    // 全齐 fixture:五必备各有其一
    const complete = [
      { name: "a_无衣物定妆_1", filePath: "role/a.png", url: "media://a" },
      { name: "b_人物海报_1", filePath: "role/b.png", url: "media://b" },
      { name: "c_三视图_1", filePath: "role/c.png", url: "media://c" },
      { name: "d_人脸_1", filePath: "role/d.png", url: "media://d" },
      { name: "e_表情差分_1", filePath: "role/e.png", url: "media://e" },
    ];
    renderPane({ images: complete, onFillMissing: vi.fn() });
    const fillAll = screen.getByRole("button", { name: "一键补缺" }) as HTMLButtonElement;
    expect(fillAll.disabled).toBe(true);
    expect(fillAll.getAttribute("title")).toContain("核心必备已齐");

    // 队列在跑(聚合相位):禁用+Loader2+进度文案在条内透出
    cleanup();
    renderPane({
      images: [],
      onFillMissing: vi.fn(),
      typeShotPhase: "generating",
      typeShotMessage: "正在补缺 1/2:无衣物定妆...",
    });
    const running = screen.getByRole("button", { name: "一键补缺" }) as HTMLButtonElement;
    expect(running.disabled).toBe(true);
    expect(running.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.getByText("正在补缺 1/2:无衣物定妆...")).toBeTruthy();
  });

  it("节头型档案徽标:七型节带透明/route 徽标,既有路节(高清人脸/表情差分)恒无", () => {
    renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn() });

    // 10-25 用户令:无衣物定妆 t2i 化(文生图身份源头)——route 徽标随迁
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(fullBody).getAllByText("透明").length).toBeGreaterThanOrEqual(1);
    expect(within(fullBody).getByText("t2i")).toBeTruthy();
    const sheet = screen.getByRole("region", { name: "设定卡" });
    expect(within(sheet).getByText("t2i")).toBeTruthy();
    expect(within(sheet).queryByText("透明")).toBeNull();
    const face = screen.getByRole("region", { name: "高清人脸" });
    expect(within(face).queryByText("i2i")).toBeNull();
    expect(within(face).queryByText("t2i")).toBeNull();
  });
});

describe("StudioAssetDetailPreviewPane · 批3 复审 H/M 修(五路互斥直达入口+完整度本行基准)", () => {
  /** 本行三型各 1(多视图/海报/人脸)→ 本行缺失=无衣物定妆+表情差分。 */
  const OWN_IMAGES = [
    { name: "晏燎_练气期_三视图_v1", filePath: "role/a1.png", url: "media://a1" },
    { name: "晏燎_练气期_人物海报_v1", filePath: "role/a2.png", url: "media://a2" },
    { name: "晏燎_练气期_高清大脸_2026年10月21日", filePath: "role/a4.png", url: "media://a4" },
  ];

  it("复审H:任一生成相位在跑,占位卡 CTA 与核心缺失 chip 全禁+title 提示,点击零派发", () => {
    const onGenerateByKind = vi.fn();
    renderPane({
      images: OWN_IMAGES,
      onGenerateByKind,
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });

    // 占位卡 CTA(无衣物定妆空节):busy 禁用+title,点击零派发
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    const cta = within(fullBody).getByRole("button", { name: "点击生成" }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute("title")).toContain("请稍候");
    fireEvent.click(cta);

    // 完整度核心缺失 chip(表情差分):busy 禁用+title,点击零派发
    const chip = screen.getByRole("button", { name: "表情差分 ✗" }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute("title")).toContain("请稍候");
    fireEvent.click(chip);

    expect(onGenerateByKind).not.toHaveBeenCalled();
  });

  it("复审M:完整度 chips/节头红点按本行 completenessImages 计,族兄弟图(展示序)不抵扣缺口", () => {
    const onGenerateByKind = vi.fn();
    const { props } = renderPane({
      // 展示序含族兄弟行三视图(画廊展示)+本行无标记主图
      images: [
        { name: "晏燎_筑基期_三视图_v1", filePath: "role/sibling.png", url: "media://sibling" },
        { name: "主图", filePath: "role/main.png", url: "media://main" },
      ],
      // 本行自有图集=仅主图(无任何核心型)→ 五必备全缺
      completenessImages: [{ name: "主图", filePath: "role/main.png", url: "media://main" }],
      onGenerateByKind,
    });

    // 画廊:人物多视图节照常展示族兄弟卡(张数=展示序 1 张)
    const multi = screen.getByRole("region", { name: "人物多视图" });
    expect(within(multi).getByText("1 张")).toBeTruthy();
    expect(within(multi).getByRole("img", { name: "晏燎_筑基期_三视图_v1" })).toBeTruthy();
    // 完整度:本行无多视图 → 红 chip 可点直达(Q1:同型图不跨行抵扣缺口)
    const chip = screen.getByRole("button", { name: "人物多视图 ✗" }) as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    fireEvent.click(chip);
    expect(props.onGenerateByKind).toHaveBeenCalledWith("人物多视图");
    // 节头红点按本行基准在场(族兄弟图展示中仍示缺)
    expect(within(multi).getByLabelText("人物多视图缺失")).toBeTruthy();
    // 已齐态不误伤:本行自有三视图 → 同型 chip ✓1(非缺失态)
    cleanup();
    renderPane({
      images: [...OWN_IMAGES, { name: "晏燎_筑基期_三视图_v1", filePath: "role/sibling.png", url: "media://sibling" }],
      completenessImages: OWN_IMAGES,
    });
    expect(screen.getByText("人物多视图 ✓1")).toBeTruthy();
    expect(screen.getByText("高清人脸 ✓1")).toBeTruthy();
  });

  it("复审M 缺省回落:不传 completenessImages 时完整度按 images 计(非族聚显调用方零变化)", () => {
    renderPane({ images: OWN_IMAGES, onGenerateByKind: vi.fn() });

    expect(screen.getByText("人物多视图 ✓1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "无衣物定妆 ✗" })).toBeTruthy();
  });
});
