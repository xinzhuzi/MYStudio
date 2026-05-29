import { describe, expect, it } from "vitest";
import {
  prepareTextCompletionRequest,
  runTextCompletionRequest,
} from "./text-completion";

describe("text completion request adapter", () => {
  const provider = {
    id: "relay",
    platform: "custom",
    name: "Relay",
    baseUrl: "https://relay.example.com/v1",
    apiKey: "sk-test",
    model: ["gpt-4o-mini"],
  };

  it("prepares OpenAI, Anthropic and Gemini attempts when protocol is not pinned", () => {
    const prepared = prepareTextCompletionRequest({
      provider,
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "回复 OK" }],
      maxTokens: 64,
      temperature: 0,
    });

    expect(prepared.success).toBe(true);
    expect(prepared.success && prepared.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
      "anthropic-compatible",
      "gemini-compatible",
    ]);
  });

  it("runs the first successful compatible text request", async () => {
    const result = await runTextCompletionRequest(
      {
        provider,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "回复 OK" }],
      },
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "OK gpt-4o-mini" } }] }), {
          status: 200,
        }),
    );

    expect(result).toMatchObject({
      success: true,
      text: "OK gpt-4o-mini",
      protocol: "openai-compatible",
    });
  });
});
