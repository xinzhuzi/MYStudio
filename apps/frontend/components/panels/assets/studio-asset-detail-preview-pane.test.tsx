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
    onExpression: vi.fn(),
    ...overrides,
  };
}

function renderPane(overrides: Partial<PreviewPaneProps> = {}) {
  const props = makeProps(overrides);
  const view = render(<StudioAssetDetailPreviewPane {...props} />);
  return { ...view, props };
}

/** 节头序(1120 用户令:人脸基准置顶→无衣物定妆次之;余承 grill Round 1 裁定2)。 */
const ROLE_SECTION_ORDER = [
  "人脸基准",
  "无衣物定妆",
  "人物海报",
  "人物多视图",
  "高清人头",
  "表情差分",
  "设定卡",
  "美宣",
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
    const faceSection = screen.getByRole("region", { name: "高清人头" });
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
    renderPane({ onFillMissing: vi.fn() });
    expect(screen.getByRole("button", { name: "一键生图" })).toBeTruthy();

    // scene/tool 同款完整度条(型谱分节画廊);clip 无型谱零侵入
    cleanup();
    renderPane({ asset: asset({ type: "scene" }), onFillMissing: vi.fn() });
    expect(screen.getByRole("button", { name: "一键生图" })).toBeTruthy();
    cleanup();
    renderPane({ asset: asset({ type: "tool" }), onFillMissing: vi.fn() });
    expect(screen.getByRole("button", { name: "一键生图" })).toBeTruthy();
    cleanup();
    renderPane({ asset: asset({ type: "clip" }) });
    expect(screen.queryByRole("button", { name: "一键生图" })).toBeNull();
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





  // 10-21 高清人头:两路按钮迁居「高清人头」节头(守卫/相位文案零变)
  it("hides the face portrait buttons by default and shows them in the 高清人头 section header for role assets", () => {
    const hidden = renderPane();
    expect(hidden.queryByRole("button", { name: /人脸·图生图/ })).toBeNull();
    expect(hidden.queryByRole("button", { name: /人脸·文生图/ })).toBeNull();

    cleanup();
    const { props } = renderPane({ canFacePortrait: true });
    const faceSection = screen.getByRole("region", { name: "高清人头" });
    fireEvent.click(within(faceSection).getByRole("button", { name: "人脸·图生图" }));
    expect(props.onFaceFromImage).toHaveBeenCalledTimes(1);
    // 10-26 用户令:高清人头没有文生图——文生图钮已删,只剩图生图一路
    expect(within(faceSection).queryByRole("button", { name: "人脸·文生图" })).toBeNull();
  });

  it("disables face-from-image without images (text route removed per 10-26 order)", () => {
    renderPane({ canFacePortrait: true, images: [] });

    const faceSection = screen.getByRole("region", { name: "高清人头" });
    const fromImage = within(faceSection).getByRole("button", { name: "人脸·图生图" }) as HTMLButtonElement;
    expect(fromImage.disabled).toBe(true);
    expect(within(faceSection).queryByRole("button", { name: "人脸·文生图" })).toBeNull();
  });

  it("shows the spinner and phase text while a face portrait is running (1120:spinner 只认 busyTarget=face-i2i)", () => {
    renderPane({ canFacePortrait: true, busyTarget: "face-i2i", facePhase: "generating", faceMessage: "正在生成 主角 的高清人头(图生图)..." });

    const faceSection = screen.getByRole("region", { name: "高清人头" });
    const buttons = within(faceSection).getAllByRole("button", { name: /人脸生成中/ });
    expect(buttons).toHaveLength(1);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.querySelector(".animate-spin")).toBeTruthy();
    }
    expect(within(faceSection).getAllByText("人脸生成中…")).toHaveLength(1);
  });

  it("1120 按钮态精修:typeShot 在跑时人脸钮不代转(灰禁点+原标签,phase 真值不再驱动 spinner)", () => {
    renderPane({ canFacePortrait: true, busyTarget: "section:无衣物定妆", typeShotPhase: "generating", typeShotMessage: "正在生成 主角 的无衣物定妆..." });

    const faceSection = screen.getByRole("region", { name: "高清人头" });
    const button = within(faceSection).getByRole("button", { name: "人脸·图生图" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".animate-spin")).toBeNull();
  });

  it("disables both face portrait entries while generation or style transfer is running", () => {
    renderPane({ canFacePortrait: true, generatePhase: "generating" });

    const faceSection = screen.getByRole("region", { name: "高清人头" });
    for (const label of ["人脸·图生图"]) {
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

  it("shows the spinner and phase text while an expression sheet is running (1120:spinner 只认 busyTarget=expression)", () => {
    renderPane({ canFacePortrait: true, busyTarget: "expression", expressionPhase: "generating", expressionMessage: "正在生成 主角 的表情差分..." });

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
    expect(screen.queryByRole("button", { name: "一键生图" })).toBeNull();
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
    const face = screen.getByRole("region", { name: "高清人头" });
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

    // 高清人头(核心)有图:无红点
    const face = screen.getByRole("region", { name: "高清人头" });
    expect(within(face).queryByLabelText("高清人头缺失")).toBeNull();
  });

  it("完整度条=单「一键生图」按钮(10-26 令:chips/标题全删;缺图才可点,点击派发补缺)", () => {
    const { props } = renderPane({ images: TYPED_IMAGES, onGenerateByKind: vi.fn(), onFillMissing: vi.fn() });
    expect(screen.queryByText("图片规范完整度")).toBeNull();
    expect(screen.queryByText(/×\d/)).toBeNull();
    const btn = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(props.onFillMissing).toHaveBeenCalledTimes(1);
    expect(props.onGenerateByKind).not.toHaveBeenCalled();
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
    // 既有路节(高清人头/表情差分)恒无型驱动钮(候 Phase 2 收编)
    expect(screen.queryByRole("button", { name: "生成高清人头" })).toBeNull();
    expect(screen.queryByRole("button", { name: "生成表情差分" })).toBeNull();
  });

  it("节头钮 gating:i2i 型零图禁用(title 提示),t2i 型(设定卡/美宣)零图可点", () => {
    renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn(),
      onFillMissing: vi.fn() });

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

  it("1120 R1/R3(AC1):节头钮被点=仅该钮 spinner+「生成中…」,其余节头原标签灰禁点不误转(旧全族 spinner 路径已删)", () => {
    renderPane({
      images: [{ name: "主图", filePath: "role/main.png", url: "media://main" }],
      canTypeShot: true,
      canFacePortrait: true,
      onTypeShot: vi.fn(),
      onFillMissing: vi.fn(),
      busyTarget: "section:无衣物定妆",
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });

    // 被点钮(无衣物定妆节头):全族唯一「生成中…」——spinner+禁点+相位文案进 title
    const runningButtons = screen.getAllByRole("button", { name: "生成中…" }) as HTMLButtonElement[];
    expect(runningButtons).toHaveLength(1);
    const clickedSection = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(clickedSection).getByRole("button", { name: "生成中…" })).toBe(runningButtons[0]);
    expect(runningButtons[0].disabled).toBe(true);
    expect(runningButtons[0].querySelector(".animate-spin")).toBeTruthy();
    expect(runningButtons[0].getAttribute("title")).toContain("无衣物定妆");
    // 其余六型节头钮:原标签+灰禁点+零 spinner(全局相位不再联动误转=病灶根修)
    for (const kind of SHOT_KINDS.filter((shotKind) => shotKind !== "无衣物定妆")) {
      const button = screen.getByRole("button", { name: `生成${kind}` }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.querySelector(".animate-spin")).toBeNull();
    }
    // 互斥家族随动:人脸钮/表情差分/一键生图全禁且原标签零转(10-25 工具行移除,图生图钮退役)
    const faceSection = screen.getByRole("region", { name: "高清人头" });
    const faceButton = within(faceSection).getByRole("button", { name: "人脸·图生图" }) as HTMLButtonElement;
    expect(faceButton.disabled).toBe(true);
    expect(faceButton.querySelector(".animate-spin")).toBeNull();
    const expressionSection = screen.getByRole("region", { name: "表情差分" });
    const expressionButton = within(expressionSection).getByRole("button", { name: "表情差分" }) as HTMLButtonElement;
    expect(expressionButton.disabled).toBe(true);
    expect(expressionButton.querySelector(".animate-spin")).toBeNull();
    const fillButton = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    expect(fillButton.disabled).toBe(true);
    expect(fillButton.querySelector(".animate-spin")).toBeNull();
    // 一键钮旁状态文字照旧滚动播报(进度不因「不陪转」失明)
    expect(screen.getByText("正在生成 主角 的无衣物定妆...")).toBeTruthy();
  });

  it("「按型出图」下拉已删(10-26 用户令:与 chip 直达/分节按钮重复);节头钮仍按型派发", () => {
    const { props } = renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn(),
      onFillMissing: vi.fn() });
    expect(screen.queryByRole("button", { name: /按型出图/ })).toBeNull();
    // 节头生成钮仍在=onTypeShot 派发不丢(1120 改序后按节定位,不依赖全局首节)
    const bareSection = screen.getByRole("region", { name: "无衣物定妆" });
    const sectionButton = within(bareSection).getAllByRole("button", { name: /生成|点击生成/ })[0];
    if (sectionButton) fireEvent.click(sectionButton);
    expect(props.onTypeShot).toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: "一键生图" })).toBeNull();
    expect(screen.queryByRole("button", { name: /生成无衣物定妆/ })).toBeNull();
  });

  it("Round 3 ⑤ scene 轨型谱:三型分节+自由+未分类沉底,完整度三核心两行分级,存量图命名归位", () => {
    renderPane({
      asset: asset({ type: "scene", name: "山门" }),
      images: [{ name: "山门_场景_v1", filePath: "scene/s1.png", url: "media://s1" }],
      onFillMissing: vi.fn(),
    });

    // 节序=scene 谱:场景→概念气氛图→3D剖面场景图→自由(10-25 无未分类节,无类型图落自由)
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "场景", "概念气氛图", "3D剖面场景图", "自由",
    ]);
    expect(screen.getByRole("button", { name: "一键生图" })).toBeTruthy();
    const sceneSection = screen.getByRole("region", { name: "场景" });
    expect(within(sceneSection).getByText("1 张")).toBeTruthy();
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
    // 道具=t2i 透明底型:零图可点(无参考需求);节头带透明+t2i(1120 R5 展示层
    // 映射「文生图」)徽标
    const propButton = screen.getByRole("button", { name: "生成道具" }) as HTMLButtonElement;
    expect(propButton.disabled).toBe(false);
    const propSection = screen.getByRole("region", { name: "道具" });
    expect(within(propSection).getAllByText("透明").length).toBeGreaterThanOrEqual(1);
    expect(within(propSection).getByText("文生图")).toBeTruthy();
    expect(within(propSection).queryByText("t2i")).toBeNull();
    // 10-26:下拉已删;role 型零泄漏仍由分节守卫承担
    expect(screen.queryByRole("button", { name: /生成无衣物定妆/ })).toBeNull();
    // 完整度核心=道具一核心;一键补缺在位
    expect(screen.getByRole("button", { name: /道具/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "一键生图" })).toBeTruthy();
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
    // 10-26:下拉已删(节头钮守卫仍验)
    fireEvent.click(sceneButton);
    expect(onTypeShot).not.toHaveBeenCalled();
  });

  it("一键补缺队列钮:五必备全齐禁用(title 已齐);busy 禁用;队列进度文案透出(1120:spinner 只认 one-key,候裁1 节头不陪转)", () => {
    // 全齐 fixture:五必备各有其一
    const complete = [
      { name: "a_无衣物定妆_1", filePath: "role/a.png", url: "media://a" },
      { name: "b_人物海报_1", filePath: "role/b.png", url: "media://b" },
      { name: "c_三视图_1", filePath: "role/c.png", url: "media://c" },
      { name: "d_人脸_1", filePath: "role/d.png", url: "media://d" },
      { name: "e_表情差分_1", filePath: "role/e.png", url: "media://e" },
    ];
    renderPane({ images: complete, onFillMissing: vi.fn() });
    // 10-26 二次令:全齐=整块不渲染(无灰钮)
    expect(screen.queryByRole("button", { name: "一键生图" })).toBeNull();

    // 队列在跑(busyTarget=one-key 被点钮转;聚合相位供状态文字):一键钮禁用+Loader2
    // +进度文案在条内透出;各型节头钮不陪转(候裁1:严格「点谁谁转」,进度靠状态文字)
    cleanup();
    renderPane({
      images: [],
      canTypeShot: true,
      onTypeShot: vi.fn(),
      onFillMissing: vi.fn(),
      busyTarget: "one-key",
      typeShotPhase: "generating",
      typeShotMessage: "正在补缺 1/2:无衣物定妆...",
    });
    const running = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    expect(running.disabled).toBe(true);
    expect(running.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.getByText("正在补缺 1/2:无衣物定妆...")).toBeTruthy();
    // 队列当前型(无衣物定妆)节头钮不陪转:原标签+灰禁点+零 spinner
    const sectionButton = screen.getByRole("button", { name: "生成无衣物定妆" }) as HTMLButtonElement;
    expect(sectionButton.disabled).toBe(true);
    expect(sectionButton.querySelector(".animate-spin")).toBeNull();
  });

  it("节头型档案徽标:七型节带透明/route 徽标(1120 R5 中文:文生图/图生图),既有路节(高清人头/表情差分)恒无", () => {
    renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn(),
      onFillMissing: vi.fn() });

    // 10-25 用户令:无衣物定妆 t2i 化(文生图身份源头)——route 徽标随迁(1120 中文化)
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(fullBody).getAllByText("透明").length).toBeGreaterThanOrEqual(1);
    expect(within(fullBody).getByText("文生图")).toBeTruthy();
    expect(within(fullBody).queryByText("t2i")).toBeNull();
    const sheet = screen.getByRole("region", { name: "设定卡" });
    expect(within(sheet).getByText("文生图")).toBeTruthy();
    expect(within(sheet).queryByText("透明")).toBeNull();
    // i2i 型(人物海报):展示层映射「图生图」,title 带语义补全
    const poster = screen.getByRole("region", { name: "人物海报" });
    expect(within(poster).getByText("图生图")).toBeTruthy();
    expect(within(poster).queryByText("i2i")).toBeNull();
    expect(within(poster).getByText("图生图").getAttribute("title")).toBe("图生图(参考图生成)");
    expect(within(sheet).getByText("文生图").getAttribute("title")).toBe("文生图(纯文字生成)");
    const face = screen.getByRole("region", { name: "高清人头" });
    expect(within(face).queryByText("图生图")).toBeNull();
    expect(within(face).queryByText("文生图")).toBeNull();
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
      onFillMissing: vi.fn(),
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });

    // 占位卡 CTA(无衣物定妆空节):busy 禁用+title,点击零派发
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    const cta = within(fullBody).getByRole("button", { name: "点击生成" }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute("title")).toContain("请稍候");
    fireEvent.click(cta);

    // 一键生图(10-26 单按钮化):busy 禁用,点击零派发
    const fill = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    expect(fill.disabled).toBe(true);
    fireEvent.click(fill);

    expect(onGenerateByKind).not.toHaveBeenCalled();
  });

  it("复审M(10-26 单按钮化随迁):completenessImages 仍定一键生图可用性(族兄弟图不抵扣缺口)", () => {
    // 本行无多视图(族兄弟有)→ 缺核心 → 按钮可点
    const { props } = renderPane({
      images: [],
      completenessImages: [{ name: "主图", filePath: "role/main.png", url: "media://main" }],
      onFillMissing: vi.fn(),
    });
    const btn1 = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    expect(btn1.disabled).toBe(false);
    fireEvent.click(btn1);
    expect(props.onFillMissing).toHaveBeenCalledTimes(1);
    // 本行自有五必备 → 全齐 → 禁用
    cleanup();
    const COMPLETE = [
      { name: "a_无衣物定妆_1", filePath: "role/a.png", url: "media://a" },
      { name: "b_人物海报_1", filePath: "role/b.png", url: "media://b" },
      { name: "c_三视图_1", filePath: "role/c.png", url: "media://c" },
      { name: "d_人脸_1", filePath: "role/d.png", url: "media://d" },
      { name: "e_表情差分_1", filePath: "role/e.png", url: "media://e" },
    ];
    renderPane({
      images: [],
      completenessImages: COMPLETE,
      onFillMissing: vi.fn(),
    });
    expect(screen.queryByRole("button", { name: "一键生图" })).toBeNull();
  });

  it("复审M 缺省回落(随迁):不传 completenessImages 时按 images 计——部分图=按钮可点", () => {
    renderPane({ images: [{ name: "a_无衣物定妆_1", filePath: "role/a.png", url: "media://a" }], onFillMissing: vi.fn() });
    const btn = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe("10-26 人物海报画幅开关挪节头", () => {
  it("只挂「人物海报」节头(与生成钮同排),其他节零出现;点击回调切换", () => {
    const onToggle = vi.fn();
    renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn(),
      onFillMissing: vi.fn(), posterLandscape: false, onTogglePosterLandscape: onToggle });
    const posterSection = screen.getByRole("region", { name: "人物海报" });
    const toggle = within(posterSection).getByRole("button", { name: "竖幅 3:4" });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // 其他节(无衣物定妆)不含画幅开关
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    expect(within(fullBody).queryByRole("button", { name: /竖幅|横幅/ })).toBeNull();
  });

  it("横幅态文案+样式随动", () => {
    renderPane({ images: [], canTypeShot: true, onTypeShot: vi.fn(),
      onFillMissing: vi.fn(), posterLandscape: true, onTogglePosterLandscape: vi.fn() });
    const posterSection = screen.getByRole("region", { name: "人物海报" });
    const toggle = within(posterSection).getByRole("button", { name: "横幅 16:9" });
    expect(toggle.className).toContain("text-primary");
  });
});

describe("StudioAssetDetailPreviewPane · 1120 生图按钮忙碌态精修(单击单转+余者置灰;11-20-asset-gen-button-busy-state)", () => {
  /** 本行多视图在场 → 无衣物定妆空节(占位 CTA 可达)。 */
  const PARTIAL_IMAGES = [
    { name: "晏燎_练气期_三视图_v1", filePath: "role/a1.png", url: "media://a1" },
  ];

  it("AC3/候裁2:占位 CTA 被点=CTA 自身 spinner+「生成中…」,该型节头钮不代转", () => {
    renderPane({
      images: PARTIAL_IMAGES,
      canTypeShot: true,
      onTypeShot: vi.fn(),
      onGenerateByKind: vi.fn(),
      onFillMissing: vi.fn(),
      busyTarget: "placeholder:无衣物定妆",
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });

    // 被点 CTA(无衣物定妆占位卡):spinner+「生成中…」+禁点
    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    const cta = within(fullBody).getByRole("button", { name: "生成中…" }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.querySelector(".animate-spin")).toBeTruthy();
    // 该型节头钮不代转:原标签+灰禁点+零 spinner
    const sectionButton = within(fullBody).getByRole("button", { name: "生成无衣物定妆" }) as HTMLButtonElement;
    expect(sectionButton.disabled).toBe(true);
    expect(sectionButton.querySelector(".animate-spin")).toBeNull();
    // 其余占位 CTA 灰禁点+原「点击生成」标签(不陪转)
    const poster = screen.getByRole("region", { name: "人物海报" });
    const posterCta = within(poster).getByRole("button", { name: "点击生成" }) as HTMLButtonElement;
    expect(posterCta.disabled).toBe(true);
    expect(posterCta.querySelector(".animate-spin")).toBeNull();
  });

  it("AC6 CTA 灰态样式:互斥在跑时占位 CTA disabled+opacity-50+cursor-not-allowed(wiring 对样式补齐)", () => {
    renderPane({
      images: PARTIAL_IMAGES,
      onGenerateByKind: vi.fn(),
      onFillMissing: vi.fn(),
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });

    const fullBody = screen.getByRole("region", { name: "无衣物定妆" });
    const cta = within(fullBody).getByRole("button", { name: "点击生成" }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute("title")).toContain("请稍候");
    // R3:disabled 灰态样式在场(视觉灰=本次补齐;jsdom 不算 CSS,断类名契约)
    expect(cta.className).toContain("disabled:opacity-50");
    expect(cta.className).toContain("disabled:cursor-not-allowed");
  });

  it("AC4 失败复原:busyTarget 清零+failed 相位残留窗=零 spinner+全族即刻可点(done/failed 反馈不禁点)", () => {
    const { props, rerender } = renderPane({
      images: PARTIAL_IMAGES,
      canTypeShot: true,
      onTypeShot: vi.fn(),
      onGenerateByKind: vi.fn(),
      onFillMissing: vi.fn(),
      busyTarget: "section:无衣物定妆",
      typeShotPhase: "generating",
      typeShotMessage: "正在生成 主角 的无衣物定妆...",
    });
    // 运行态基线:被点钮在转
    expect(screen.getAllByRole("button", { name: "生成中…" })).toHaveLength(1);

    // 失败后装配:finally 清 busyTarget(AC4 硬门);相位 failed=结果反馈残留
    // (3s 窗)但不再禁点——全族即刻可点+零 spinner
    rerender(<StudioAssetDetailPreviewPane {...props} busyTarget={null} typeShotPhase="failed" typeShotMessage="无衣物定妆生成失败: 引擎拒绝" />);
    expect(screen.queryByRole("button", { name: "生成中…" })).toBeNull();
    expect(document.querySelectorAll(".animate-spin").length).toBe(0);
    // 被点钮(无衣物定妆):失败反馈文案可点零 spinner(done/failed 相位=反馈不禁点;
    // typeShot 相位文案全族节头共享=既有反馈语义,spinner 归属只认 busyTarget)
    const failedButtons = screen.getAllByRole("button", { name: "生成失败" }) as HTMLButtonElement[];
    // 角色谱七型节头钮(无衣物定妆/人物海报/人物多视图/人脸基准/自由/设定卡/美宣)
    expect(failedButtons.length).toBe(7);
    for (const button of failedButtons) {
      expect(button.disabled).toBe(false);
      expect(button.querySelector(".animate-spin")).toBeNull();
    }
    // 占位 CTA 全部回原「点击生成」可点(失败复原=全族即刻可点)
    for (const cta of screen.getAllByRole("button", { name: "点击生成" }) as HTMLButtonElement[]) {
      expect(cta.disabled).toBe(false);
      expect(cta.querySelector(".animate-spin")).toBeNull();
    }
    const fillButton = screen.getByRole("button", { name: "一键生图" }) as HTMLButtonElement;
    expect(fillButton.disabled).toBe(false);
    expect(fillButton.querySelector(".animate-spin")).toBeNull();
    // 失败反馈文案保留(相位供结果反馈消费,R3)
    expect(screen.getByText("无衣物定妆生成失败: 引擎拒绝")).toBeTruthy();
  });
});
