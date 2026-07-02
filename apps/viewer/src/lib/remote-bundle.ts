export const REMOTE_BUNDLE_MAX_BYTES = 5 * 1024 * 1024;

export const DEFAULT_LARGE_BUNDLE_CDN_PREFIX =
  "https://cdn.jsdelivr.net/gh/SeerAPI/seer-unity-assets-pet_anim_part@main/newseer/assetbundles/PetAnimPackage";

export interface RemoteBundleRef {
  path: string;
  name: string;
  fileSize: number;
  mirrored?: boolean;
}

/** 将索引 bundle 名称映射为 GitHub 图床文件名 */
export function cdnFileName(bundleName: string): string {
  if (bundleName.startsWith("petanimpackage_share_")) {
    return `${bundleName}.bundle`;
  }
  return bundleName;
}

/** 空字符串表示禁用；未设置时使用默认 jsDelivr 前缀 */
export function getLargeBundleCdnPrefix(): string | null {
  const value = import.meta.env.VITE_LARGE_BUNDLE_CDN_PREFIX;
  if (value === "") return null;
  return value ?? DEFAULT_LARGE_BUNDLE_CDN_PREFIX;
}

export function hasCdnMirror(item: RemoteBundleRef): boolean {
  return !!item.mirrored && getLargeBundleCdnPrefix() !== null;
}

export function isRemoteBundleAllowed(item: RemoteBundleRef): boolean {
  if (item.fileSize < REMOTE_BUNDLE_MAX_BYTES) return true;
  return hasCdnMirror(item);
}

export function remoteBundleBlockedMessage(fileSize: number): string {
  const mb = (fileSize / (1024 * 1024)).toFixed(1);
  return `该资源约 ${mb} MB，图床暂无镜像，请通过顶部菜单导入本地 bundle`;
}

export function formatBundleHttpError(status: number): string {
  switch (status) {
    case 400:
      return "请求无效，请刷新页面后重试";
    case 403:
      return "无权访问该资源";
    case 404:
      return "资源不存在，可能尚未上传至图床或索引未更新";
    case 408:
    case 504:
      return "下载超时，请检查网络后重试";
    case 413:
      return "资源体积超过同域代理限制（5 MB），请稍后重试或导入本地 bundle";
    case 502:
    case 503:
      return "远程服务暂时不可用，请稍后重试";
    default:
      if (status >= 500) {
        return `服务器错误（HTTP ${status}），请稍后重试`;
      }
      return `下载失败（HTTP ${status}）`;
  }
}

/** 空字符串表示禁用远程加载；未设置时开发环境默认 /proxy */
export function getBundleProxyPrefix(): string | null {
  const value = import.meta.env.VITE_BUNDLE_PROXY_PREFIX;
  if (value === "") return null;
  return value ?? "/proxy";
}

export function isRemoteBundleEnabled(): boolean {
  return getBundleProxyPrefix() !== null;
}

export function bundleProxyUrl(hash: string): string {
  const prefix = getBundleProxyPrefix();
  if (!prefix) {
    throw new Error("远程 bundle 代理未配置");
  }
  const base = prefix.replace(/\/$/, "");
  return `${base}/${hash}`;
}

export function resolveBundleFetchUrl(item: RemoteBundleRef): string {
  if (item.fileSize >= REMOTE_BUNDLE_MAX_BYTES && hasCdnMirror(item)) {
    const prefix = getLargeBundleCdnPrefix()!;
    return `${prefix.replace(/\/$/, "")}/${cdnFileName(item.name)}`;
  }
  return bundleProxyUrl(item.path);
}

export interface DownloadProgress {
  loaded: number;
  total: number | null;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export interface FetchBundleOptions {
  onProgress?: DownloadProgressCallback;
  /** Content-Length 缺失时的预期体积（如索引 fileSize） */
  expectedSize?: number;
}

export function downloadProgressPercent(
  progress: DownloadProgress,
): number | null {
  const total = progress.total;
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((progress.loaded / total) * 100));
}

export async function fetchBundleBuffer(
  hash: string,
  options?: FetchBundleOptions,
): Promise<ArrayBuffer> {
  return fetchBundleFromUrl(bundleProxyUrl(hash), options);
}

export async function fetchBundleFromIndex(
  item: RemoteBundleRef,
  options?: FetchBundleOptions,
): Promise<ArrayBuffer> {
  if (!isRemoteBundleAllowed(item)) {
    throw new Error(remoteBundleBlockedMessage(item.fileSize));
  }
  return fetchBundleFromUrl(resolveBundleFetchUrl(item), {
    ...options,
    expectedSize:
      options?.expectedSize ??
      (item.fileSize > 0 ? item.fileSize : undefined),
  });
}

async function fetchBundleFromUrl(
  url: string,
  options?: FetchBundleOptions,
): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "force-cache" });
  } catch {
    throw new Error("网络连接失败，请检查网络后重试");
  }

  if (!res.ok) {
    throw new Error(formatBundleHttpError(res.status));
  }

  try {
    return await readResponseWithProgress(res, options);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("资源数据")) {
      throw e;
    }
    throw new Error("资源数据读取失败，请重试");
  }
}

async function readResponseWithProgress(
  res: Response,
  options?: FetchBundleOptions,
): Promise<ArrayBuffer> {
  const headerLength = res.headers.get("Content-Length");
  const parsedLength = headerLength
    ? Number.parseInt(headerLength, 10)
    : Number.NaN;
  const total =
    Number.isFinite(parsedLength) && parsedLength > 0
      ? parsedLength
      : options?.expectedSize && options.expectedSize > 0
        ? options.expectedSize
        : null;

  const report = (loaded: number) => {
    options?.onProgress?.({ loaded, total });
  };

  if (!res.body) {
    const buffer = await res.arrayBuffer();
    report(buffer.byteLength);
    return buffer;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    report(loaded);
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  report(loaded);
  return out.buffer;
}
