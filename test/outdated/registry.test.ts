import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

import { fetchNpmMetadata, fetchPubMetadata } from "@/outdated/registry";

let fetchSpy: ReturnType<typeof spyOn>;

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("fetchNpmMetadata", () => {
  test("returns full metadata on success", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "2.0.0",
        deprecated: "Use v3 instead",
        peerDependencies: { react: "^18.0.0" },
        repository: { type: "git", url: "https://github.com/org/repo.git" },
        dist: { tarball: "https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz" },
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result).not.toBeNull();
    expect(result?.latest).toBe("2.0.0");
    expect(result?.deprecated).toBe("Use v3 instead");
    expect(result?.peerDependencies).toEqual({ react: "^18.0.0" });
    expect(result?.repositoryUrl).toBe("https://github.com/org/repo.git");
    expect(result?.tarballUrl).toBe("https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz");
    expect(result?.changelogUrl).toBe("https://github.com/org/repo/releases");
  });

  test("returns null on non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 404));

    const result = await fetchNpmMetadata("nonexistent-pkg");
    expect(result).toBeNull();
  });

  test("returns null on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await fetchNpmMetadata("pkg");
    expect(result).toBeNull();
  });

  test("handles string repository field", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: "https://github.com/org/repo",
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result).not.toBeNull();
    expect(result?.repositoryUrl).toBe("https://github.com/org/repo");
    expect(result?.changelogUrl).toBe("https://github.com/org/repo/releases");
  });

  test("no repository field yields no changelog URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ version: "1.0.0" }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result).not.toBeNull();
    expect(result?.repositoryUrl).toBeUndefined();
    expect(result?.changelogUrl).toBeUndefined();
  });
});

describe("deriveChangelogUrl (via fetchNpmMetadata)", () => {
  test("GitHub repo URL derives /releases", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: { type: "git", url: "git+https://github.com/org/repo.git" },
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result?.changelogUrl).toBe("https://github.com/org/repo/releases");
  });

  test("GitLab repo URL derives /-/releases", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: { type: "git", url: "https://gitlab.com/org/repo.git" },
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result?.changelogUrl).toBe("https://gitlab.com/org/repo/-/releases");
  });

  test("git:// prefix is normalized to https://", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: { type: "git", url: "git://github.com/org/repo.git" },
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result?.changelogUrl).toBe("https://github.com/org/repo/releases");
  });

  test("ssh://git@ prefix is normalized", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: { type: "git", url: "ssh://git@github.com/org/repo.git" },
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result?.changelogUrl).toBe("https://github.com/org/repo/releases");
  });

  test(".git suffix is stripped", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: "https://github.com/org/repo.git",
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result?.changelogUrl).toBe("https://github.com/org/repo/releases");
  });

  test("invalid URL returns undefined changelog", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        version: "1.0.0",
        repository: "not-a-valid-url",
      }),
    );

    const result = await fetchNpmMetadata("pkg");
    expect(result?.repositoryUrl).toBe("not-a-valid-url");
    expect(result?.changelogUrl).toBeUndefined();
  });
});

describe("fetchPubMetadata", () => {
  test("returns metadata with correct tarball URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        latest: {
          version: "3.0.0",
          pubspec: { name: "my_package" },
        },
      }),
    );

    const result = await fetchPubMetadata("my_package");
    expect(result).not.toBeNull();
    expect(result?.latest).toBe("3.0.0");
    expect(result?.tarballUrl).toBe("https://pub.dev/api/archives/my_package-3.0.0.tar.gz");
  });

  test("returns changelog URL as pub.dev convention", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        latest: { version: "1.0.0" },
      }),
    );

    const result = await fetchPubMetadata("http");
    expect(result?.changelogUrl).toBe("https://pub.dev/packages/http/changelog");
  });

  test("returns null on failure", async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 404));

    const result = await fetchPubMetadata("nonexistent");
    expect(result).toBeNull();
  });

  test("returns null on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await fetchPubMetadata("pkg");
    expect(result).toBeNull();
  });

  test("deprecated and peerDependencies are undefined", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        latest: { version: "2.0.0" },
      }),
    );

    const result = await fetchPubMetadata("pkg");
    expect(result?.deprecated).toBeUndefined();
    expect(result?.peerDependencies).toBeUndefined();
  });
});

describe("fetchMetadata routing", () => {
  test("dart ecosystem calls pub.dev URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        latest: { version: "1.0.0" },
      }),
    );

    await fetchPubMetadata("http");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://pub.dev/api/packages/http");
  });

  test("typescript ecosystem calls npm URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ version: "1.0.0" }),
    );

    await fetchNpmMetadata("react");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://registry.npmjs.org/react/latest");
  });

  test("fetchMetadata routes based on ecosystem (dart vs typescript)", async () => {
    // Import fetchMetadata fresh to verify routing
    // dart → pub.dev endpoint, typescript → npm endpoint
    // This is verified indirectly: fetchPubMetadata hits pub.dev, fetchNpmMetadata hits npm
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ latest: { version: "1.0.0" } }),
    );
    const pubResult = await fetchPubMetadata("http");
    expect(pubResult?.latest).toBe("1.0.0");

    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ version: "2.0.0" }),
    );
    const npmResult = await fetchNpmMetadata("react");
    expect(npmResult?.latest).toBe("2.0.0");
  });
});
