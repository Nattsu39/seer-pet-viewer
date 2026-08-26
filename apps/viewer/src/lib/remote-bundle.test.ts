import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CdnFileTooLargeError,
  CDN_FILE_SIZE_LIMIT_HINT,
  cdnFileTooLargeMessage,
  fetchBundleFromIndex,
  githubBundleRawDownloadUrl,
  type RemoteBundleRef,
} from "./remote-bundle";

function bundleRef(overrides: Partial<RemoteBundleRef> = {}): RemoteBundleRef {
  return {
    path: "0123456789abcdef0123456789abcdef",
    name: "petanimpackage_1234",
    fileSize: 25 * 1024 * 1024,
    mirrored: true,
    ...overrides,
  };
}

function stubFetch(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("githubBundleRawDownloadUrl（CDN 文件超限时的 GitHub raw 直链）", () => {
  it("默认 jsDelivr 前缀下返回对应 raw.githubusercontent.com 直链", () => {
    expect(githubBundleRawDownloadUrl(bundleRef())).toBe(
      "https://raw.githubusercontent.com/SeerAPI/seer-unity-assets-pet_anim_part/main/newseer/assetbundles/PetAnimPackage/petanimpackage_1234",
    );
  });

  it("共享包文件名追加 .bundle 后缀", () => {
    expect(
      githubBundleRawDownloadUrl(
        bundleRef({ name: "petanimpackage_share_materials" }),
      ),
    ).toBe(
      "https://raw.githubusercontent.com/SeerAPI/seer-unity-assets-pet_anim_part/main/newseer/assetbundles/PetAnimPackage/petanimpackage_share_materials.bundle",
    );
  });
});

describe("CDN 文件超限（403 + 提示文案）识别", () => {
  it("错误信息以“文件过大无法下载”开头", () => {
    expect(cdnFileTooLargeMessage()).toContain("文件过大无法下载");
  });

  it("CDN 返回 403 且内容为文件超限提示时抛出 CdnFileTooLargeError", async () => {
    stubFetch(403, `<!DOCTYPE html>\n${CDN_FILE_SIZE_LIMIT_HINT}\n`);
    await expect(fetchBundleFromIndex(bundleRef())).rejects.toBeInstanceOf(
      CdnFileTooLargeError,
    );
  });

  it("CDN 返回 403 但内容不同时使用通用 403 错误", async () => {
    stubFetch(403, "Forbidden");
    await expect(fetchBundleFromIndex(bundleRef())).rejects.toThrow(
      "无权访问该资源",
    );
  });
});
