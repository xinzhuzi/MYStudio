import { describe, expect, it } from "vitest";
import { AUTHOR_PREFERENCE_MAX_CHARS, AUTHOR_PREFERENCE_TEMPLATE } from "./author-preference";
import {
  buildAuthorPreferenceFillMessages,
  runAuthorPreferenceFill,
  sanitizeAuthorPreferenceDraft,
} from "./author-preference-fill";

describe("buildAuthorPreferenceFillMessages", () => {
  it("embeds taste intent and keeps the strict template contract", () => {
    const messages = buildAuthorPreferenceFillMessages({
      questions: {
        genres: ["仙侠", "悬疑"],
        adaptDegree: "大胆改编",
        pacing: "快节奏强钩子",
        dealbreakers: "不要回忆杀开场",
      },
    });
    expect(messages.system).toContain("## 改编口味");
    expect(messages.system).toContain("## 叙事偏好");
    expect(messages.system).toContain("## 口味雷点");
    expect(messages.system).toContain(`${AUTHOR_PREFERENCE_MAX_CHARS - 400} 字以内`);
    expect(messages.user).toContain("题材偏好：仙侠、悬疑");
    expect(messages.user).toContain("改编幅度：大胆改编");
    expect(messages.user).toContain("节奏口味：快节奏强钩子");
    expect(messages.user).toContain("明确雷点：不要回忆杀开场");
  });

  it("sends existing edited text as optimization base but not the untouched template", () => {
    const edited = "# 作者偏好\n\n## 改编口味\n快节奏强爽感\n";
    const withEdited = buildAuthorPreferenceFillMessages({ currentText: edited });
    expect(withEdited.user).toContain("在其基础上优化补全");

    const withTemplate = buildAuthorPreferenceFillMessages({ currentText: AUTHOR_PREFERENCE_TEMPLATE });
    expect(withTemplate.user).not.toContain("在其基础上优化补全");
  });
});

describe("sanitizeAuthorPreferenceDraft", () => {
  it("strips code fences and prepends the H1 when the model omits it", () => {
    const result = sanitizeAuthorPreferenceDraft(
      "```markdown\n## 改编口味\n快节奏\n\n## 叙事偏好\n多对白\n\n## 口味雷点\n不卖惨\n```",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.startsWith("# 作者偏好")).toBe(true);
    expect(result.markdown).toContain("## 改编口味");
  });

  it("trims over-limit drafts at a line boundary and keeps it under the cap", () => {
    const long = `# 作者偏好\n\n## 改编口味\n${"很长的口味条目。".repeat(300)}\n\n## 叙事偏好\n多对白`;
    const result = sanitizeAuthorPreferenceDraft(long);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.length).toBeLessThanOrEqual(AUTHOR_PREFERENCE_MAX_CHARS);
    expect(result.markdown.endsWith("\n")).toBe(true);
  });

  it("rejects empty drafts", () => {
    expect(sanitizeAuthorPreferenceDraft("   ").ok).toBe(false);
  });
});

describe("runAuthorPreferenceFill", () => {
  it("round-trips messages through callText and returns sanitized markdown", async () => {
    const result = await runAuthorPreferenceFill({
      questions: { pacing: "张弛交替" },
      callText: async (messages) => {
        expect(messages.user).toContain("张弛交替");
        return "## 改编口味\n条目A";
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("# 作者偏好");
    expect(result.markdown).toContain("条目A");
  });

  it("surfaces callText failures without throwing", async () => {
    const result = await runAuthorPreferenceFill({
      callText: async () => {
        throw new Error("网络不可用");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("网络不可用");
  });
});
