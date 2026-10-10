import { describe, expect, it } from "vitest";
import { DIRECTOR_PREFERENCE_MAX_CHARS, DIRECTOR_PREFERENCE_TEMPLATE } from "./director-preference";
import {
  buildDirectorPreferenceFillMessages,
  runDirectorPreferenceFill,
  sanitizeDirectorPreferenceDraft,
} from "./director-preference-fill";

describe("buildDirectorPreferenceFillMessages", () => {
  it("embeds taste intent and keeps the Hermes-style entry contract", () => {
    const messages = buildDirectorPreferenceFillMessages({
      questions: {
        genres: ["仙侠", "悬疑"],
        adaptDegree: "大胆改编",
        pacing: "快节奏强钩子",
        dealbreakers: "不要回忆杀开场",
      },
    });
    expect(messages.system).toContain("改编原则");
    expect(messages.system).toContain("叙事手法");
    expect(messages.system).toContain("创作红线");
    expect(messages.system).toContain("视听语言");
    expect(messages.system).toContain("## 改编原则");
    expect(messages.system).toContain("`- ` 无序列表");
    expect(messages.system).toContain("禁止同义反复");
    expect(messages.system).toContain("机械降神");
    expect(messages.system).toContain(`${DIRECTOR_PREFERENCE_MAX_CHARS - 400} 字以内`);
    expect(messages.user).toContain("题材偏好：仙侠、悬疑");
    expect(messages.user).toContain("改编幅度：大胆改编");
    expect(messages.user).toContain("节奏口味：快节奏强钩子");
    expect(messages.user).toContain("明确雷点：不要回忆杀开场");
  });

  it("sends existing edited text as optimization base but not the untouched template", () => {
    const edited = "# 导演偏好\n\n改编口味: 快节奏强爽感\n§\n";
    const withEdited = buildDirectorPreferenceFillMessages({ currentText: edited });
    expect(withEdited.user).toContain("在其基础上按原子条目增删修订");

    const withTemplate = buildDirectorPreferenceFillMessages({ currentText: DIRECTOR_PREFERENCE_TEMPLATE });
    expect(withTemplate.user).not.toContain("在其基础上按原子条目增删修订");
  });
});

describe("sanitizeDirectorPreferenceDraft", () => {
  it("strips code fences and prepends the H1 when the model omits it", () => {
    const result = sanitizeDirectorPreferenceDraft(
      "```markdown\n改编口味: 快节奏\n§\n叙事偏好: 多对白\n§\n口味雷点: 不卖惨\n```",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.startsWith("# 导演偏好")).toBe(true);
    expect(result.markdown).toContain("改编口味: 快节奏");
  });

  it("trims over-limit drafts at a line boundary and keeps it under the cap", () => {
    const long = `# 导演偏好\n\n## 改编原则\n- 快节奏强钩子\n- ${"很长的条目。".repeat(340)}\n\n## 叙事手法\n- 多对白`;
    const result = sanitizeDirectorPreferenceDraft(long);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.length).toBeLessThanOrEqual(DIRECTOR_PREFERENCE_MAX_CHARS);
    expect(result.markdown.endsWith("\n")).toBe(true);
    expect(result.markdown).toContain("## ");
  });

  it("rejects empty drafts", () => {
    expect(sanitizeDirectorPreferenceDraft("   ").ok).toBe(false);
  });
});

describe("runDirectorPreferenceFill", () => {
  it("round-trips messages through callText and returns sanitized markdown", async () => {
    const result = await runDirectorPreferenceFill({
      questions: { pacing: "张弛交替" },
      callText: async (messages) => {
        expect(messages.user).toContain("张弛交替");
        return "改编口味: 条目A";
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("# 导演偏好");
    expect(result.markdown).toContain("条目A");
  });

  it("surfaces callText failures without throwing", async () => {
    const result = await runDirectorPreferenceFill({
      callText: async () => {
        throw new Error("网络不可用");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("网络不可用");
  });
});
