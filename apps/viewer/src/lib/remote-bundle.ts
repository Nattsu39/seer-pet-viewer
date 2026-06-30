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

export async function fetchBundleBuffer(hash: string): Promise<ArrayBuffer> {
  const res = await fetch(bundleProxyUrl(hash), { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`下载失败 (${res.status})`);
  }
  return res.arrayBuffer();
}
