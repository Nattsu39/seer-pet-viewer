const REMOTE_BASE =
  "https://newseer.61.com/Assets/StandaloneWindows64/PetAnimPackage";
const PACKAGE_NAME = "PetAnimPackage";

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  referer: "https://newseer.61.com",
};

/** @param {string} url */
async function fetchText(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) {
    throw new Error(`请求失败 ${res.status}: ${url}`);
  }
  return res.text();
}

/** @param {string} url */
async function fetchBytes(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) {
    throw new Error(`请求失败 ${res.status}: ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** @param {string} [baseUrl] */
export async function fetchRemoteManifest(baseUrl = REMOTE_BASE) {
  const versionUrl = `${baseUrl}/PackageManifest_${PACKAGE_NAME}.version?t=${Date.now()}`;
  const version = (await fetchText(versionUrl)).trim();
  if (!version) {
    throw new Error("远程版本号为空");
  }

  const manifestUrl = `${baseUrl}/PackageManifest_${PACKAGE_NAME}_${version}.bytes?t=${Date.now()}`;
  const bytes = await fetchBytes(manifestUrl);

  return { version, bytes, manifestUrl };
}
