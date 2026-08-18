import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  net: { fetch: fetchMock },
}));

import { fetchUpdateManifest, resolveAvailableUpdate } from "./main-update";

const GITHUB_CONFIG = {
  manifestUrl: "https://api.github.com/repos/xinzhuzi/MYStudio/releases/latest",
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const GITHUB_RELEASE = {
  tag_name: "v0.0.3",
  name: "manying-studio 0.0.3",
  body: "修复若干问题",
  html_url: "https://github.com/xinzhuzi/MYStudio/releases/tag/v0.0.3",
  published_at: "2026-08-18T00:00:00Z",
};

describe("fetchUpdateManifest (GitHub Releases API)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("maps the latest release onto the manifest shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GITHUB_RELEASE));
    const manifest = await fetchUpdateManifest(GITHUB_CONFIG);
    expect(manifest).toEqual({
      version: "v0.0.3",
      releaseNotes: "修复若干问题",
      publishedAt: "2026-08-18T00:00:00Z",
      githubUrl: "https://github.com/xinzhuzi/MYStudio/releases/tag/v0.0.3",
      baiduUrl: undefined,
      baiduCode: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_CONFIG.manifestUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/vnd.github+json" }),
      }),
    );
  });

  it("fails closed when the release payload has no usable version", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, false, 404));
    await expect(fetchUpdateManifest(GITHUB_CONFIG)).rejects.toThrow(/GitHub release 请求失败/);
  });

  it("drops a release page URL outside the download allowlist", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...GITHUB_RELEASE, html_url: "http://evil.test/dmg" }));
    const manifest = await fetchUpdateManifest(GITHUB_CONFIG);
    expect(manifest.githubUrl).toBeUndefined();
    expect(manifest.version).toBe("v0.0.3");
  });
});

describe("resolveAvailableUpdate (GitHub source)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("reports an update when the latest tag is newer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GITHUB_RELEASE));
    const update = await resolveAvailableUpdate(GITHUB_CONFIG, "0.0.2");
    expect(update).toMatchObject({
      currentVersion: "0.0.2",
      latestVersion: "v0.0.3",
      githubUrl: "https://github.com/xinzhuzi/MYStudio/releases/tag/v0.0.3",
    });
  });

  it("returns null when already on the latest tag", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GITHUB_RELEASE));
    expect(await resolveAvailableUpdate(GITHUB_CONFIG, "0.0.3")).toBeNull();
  });
});

describe("fetchUpdateManifest (legacy JSON manifest)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("still reads a self-hosted JSON manifest with cache busting", async () => {
    const config = { manifestUrl: "https://updates.example.test/version.json" };
    fetchMock.mockImplementationOnce(async (url: string) => (
      jsonResponse({ version: "1.2.3", githubUrl: "https://github.com/xinzhuzi/MYStudio" })
    ));
    const manifest = await fetchUpdateManifest(config);
    expect(manifest.version).toBe("1.2.3");
    expect(String(fetchMock.mock.calls[0][0])).toContain("_ts=");
  });
});
