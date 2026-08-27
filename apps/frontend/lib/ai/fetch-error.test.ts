import { describe, expect, it } from "vitest";
import { createDescribedFetchError, describeFetchError, isNetworkFailureError, isTimeoutFailureError } from "./fetch-error";

/** 模拟 undici/Node fetch 的网络失败:message 恒为 "fetch failed",真实原因在 cause */
function undiciFetchFailure(cause: unknown): Error {
  return new TypeError("fetch failed", { cause });
}

describe("describeFetchError", () => {
  it("translates DNS resolution failures from the undici cause chain", () => {
    const error = undiciFetchFailure(
      Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), { code: "ENOTFOUND" }),
    );
    const description = describeFetchError(error, { endpoint: "https://api.example.com/v1/chat/completions" });
    expect(description).toContain("域名解析失败");
    expect(description).toContain("api.example.com");
  });

  it("unwraps AggregateError causes produced by undici connection attempts", () => {
    const aggregate = new AggregateError([
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8000"), { code: "ECONNREFUSED" }),
    ]);
    const description = describeFetchError(undiciFetchFailure(aggregate), { endpoint: "http://127.0.0.1:8000/v1" });
    expect(description).toContain("服务器拒绝连接");
    expect(description).toContain("127.0.0.1:8000");
  });

  it("keeps digging when the first cause is another generic wrapper", () => {
    const error = undiciFetchFailure(
      new TypeError("terminated", {
        cause: Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" }),
      }),
    );
    const description = describeFetchError(error);
    expect(description).toContain("超时");
  });

  it("explains bare fetch failures without any cause", () => {
    const description = describeFetchError(undiciFetchFailure(undefined), { endpoint: "https://api.example.com/v1" });
    expect(description).toContain("网络请求失败");
    expect(description).toContain("未获取到具体原因");
    expect(description).toContain("api.example.com");
  });

  it("maps TLS certificate problems to a certificate hint", () => {
    const error = undiciFetchFailure(
      Object.assign(new Error("unable to verify the first certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }),
    );
    expect(describeFetchError(error)).toContain("证书校验失败");
  });

  it("translates abort errors into readable timeout messages", () => {
    const abort = new DOMException("This operation was aborted", "AbortError");
    const description = describeFetchError(abort, { timeoutLabel: "文本模型调用", timeoutMs: 300000 });
    expect(description).toBe("文本模型调用超时 (300s)");
  });

  it("falls back to a generic timeout label when none is provided", () => {
    const abort = new DOMException("This operation was aborted", "AbortError");
    expect(describeFetchError(abort)).toBe("请求超时");
  });

  it("preserves non-network error messages and appends the endpoint host", () => {
    const description = describeFetchError(new Error("无法解析响应"), { endpoint: "https://api.example.com/v1/x" });
    expect(description).toBe("无法解析响应 · 目标 https://api.example.com");
  });

  it("handles plain string rejections", () => {
    const description = describeFetchError("boom", { endpoint: "https://api.example.com/v1" });
    expect(description).toBe("boom · 目标 https://api.example.com");
  });

  it("marks browser-style fetch failures as network failures", () => {
    const description = describeFetchError(new TypeError("Failed to fetch"), { endpoint: "https://api.example.com" });
    expect(description).toContain("网络请求失败");
  });

  it("strips the Electron IPC error prefix before describing", () => {
    const inner = undiciFetchFailure(
      Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), { code: "ENOTFOUND" }),
    );
    const wrapped = new Error(
      `Error invoking remote method 'api-image-request': TypeError: ${inner.message}`,
      { cause: inner.cause },
    );
    const description = describeFetchError(wrapped, { endpoint: "https://api.example.com/v1" });
    expect(description).not.toContain("Error invoking remote method");
    expect(description).toContain("域名解析失败");
  });

  it("flags transport failures on described errors", () => {
    const described = createDescribedFetchError(undiciFetchFailure(undefined), { endpoint: "https://api.example.com" });
    expect(described.networkFailure).toBe(true);

    const timeout = createDescribedFetchError(new DOMException("This operation was aborted", "AbortError"), { timeoutMs: 30000 });
    expect(timeout.networkFailure).toBe(true);
    expect(timeout.timeoutFailure).toBe(true);

    const http = createDescribedFetchError(new Error("图片生成 API 错误: 502"));
    expect(http.networkFailure).toBeUndefined();
  });

  it("detects network failures from flags first, then stable message markers", () => {
    expect(isNetworkFailureError(createDescribedFetchError(undiciFetchFailure(undefined)))).toBe(true);
    expect(isNetworkFailureError(new Error("网络请求失败:域名解析失败,无法找到服务器地址(检查 Base URL 域名或本机网络/DNS)"))).toBe(true);
    expect(isNetworkFailureError(new TypeError("fetch failed"))).toBe(true);
    // HTTP 状态错误与任务级轮询超时不算传输层失败(整单重试有重复付费风险)
    expect(isNetworkFailureError(new Error("图片生成 API 错误: 502"))).toBe(false);
    expect(isNetworkFailureError(new Error("视频生成超时(已轮询 180 次、约 15 分钟仍未出片)"))).toBe(false);
    expect(isTimeoutFailureError(new Error("图片生成请求超时(180s),可重试或稍后再试"))).toBe(true);
    expect(isTimeoutFailureError(new Error("普通业务错误"))).toBe(false);
  });

  it("passes already-enriched messages through untouched", () => {
    const enriched = "网络请求失败:服务器拒绝连接(端口未开放或服务未启动) · 目标 https://api.example.com";
    const description = describeFetchError(new Error(enriched), { endpoint: "https://api.example.com/v1/other" });
    expect(description).toBe(enriched);
  });
});
