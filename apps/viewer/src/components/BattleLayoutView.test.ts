import { createApp, nextTick, ref, shallowRef, type App } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ViewerApp from "../App.vue";
import { usePetLoader } from "../composables/usePetLoader";

vi.mock("../composables/usePetLoader", () => ({ usePetLoader: vi.fn() }));
vi.mock("./PetPicker.vue", () => ({ default: { template: "<div />" } }));
vi.mock("./PetViewer.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@seer-pet-anim/swf-renderer", () => ({ SwfPlayer: vi.fn() }));
vi.mock("@seer-pet-anim/spine-renderer", () => ({ SpinePlayer: vi.fn() }));
vi.mock("@seer-pet-anim/swf-bundle", () => ({ ensureSwfClipAtlas: vi.fn() }));
vi.mock("../composables/useAnimationExport", () => ({
  useAnimationExport: () => ({
    exportFormat: ref("webp"),
    exportScale: ref(1),
    exportBackground: ref(false),
    exporting: ref(false),
    mp4UnavailableReason: ref(""),
    cancelExport: vi.fn(),
  }),
}));

function createLoader(): ReturnType<typeof usePetLoader> {
  return {
    pet: shallowRef(null),
    loading: ref(false),
    loadingMessage: ref(null),
    error: ref(null),
    downloadProgress: ref(null),
    downloadingBundle: ref(false),
    cdnFileTooLarge: ref(false),
    remoteLoadContext: ref(null),
    parseMs: ref(0),
    warnings: ref([]),
    warningsVisible: ref(true),
    materialCount: ref(0),
    sharedMaterialBundleName: "shared.bundle",
    loadBundleFile: vi.fn(),
    loadBundleFromRemote: vi.fn(),
    retryRemoteLoad: vi.fn(),
    dismissError: vi.fn(),
    dismissWarnings: vi.fn(),
    downloadNamedRemoteBundle: vi.fn(),
    loadSwfClipDir: vi.fn(),
    loadSpineClipDir: vi.fn(),
    loadMaterialBundle: vi.fn(),
    reset: vi.fn(),
  };
}

let app: App;
let host: HTMLDivElement;
let loaders: ReturnType<typeof createLoader>[];

function button(container: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, `button: ${text}`).toBeDefined();
  return found!;
}

async function importFile(input: HTMLInputElement, file: File) {
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await nextTick();
}

beforeEach(async () => {
  loaders = [];
  vi.mocked(usePetLoader).mockImplementation(() => {
    const loader = createLoader();
    loaders.push(loader);
    return loader;
  });
  host = document.createElement("div");
  document.body.append(host);
  app = createApp(ViewerApp);
  app.mount(host);
  button(host, "战斗布局").click();
  await vi.waitFor(
    () => expect(host.querySelectorAll(".side-panel")).toHaveLength(2),
    { timeout: 5000 },
  );
});

afterEach(() => {
  app.unmount();
  host.remove();
  vi.clearAllMocks();
});

it("imports bundles into either battle side without touching the single viewer", async () => {
  const panels = host.querySelectorAll(".side-panel");
  const file = new File(["bundle"], "official-hash-without-extension");
  for (const [index, panel] of Array.from(panels).entries()) {
    const input = panel.querySelector<HTMLInputElement>('input[type="file"]')!;
    await importFile(input, file);
    expect(loaders[index + 1].loadBundleFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  }
  expect(loaders[0].loadBundleFile).not.toHaveBeenCalled();
});

it("routes header bundle and material imports to the selected battle side", async () => {
  const file = new File(["bundle"], "pet.bundle");
  const headerInputs = host.querySelectorAll<HTMLInputElement>(
    'header input[type="file"]',
  );
  await importFile(headerInputs[0], file);
  expect(loaders[1].loadBundleFile).toHaveBeenCalledWith(file);
  (host.querySelectorAll(".side-panel")[1] as HTMLElement).click();
  await nextTick();
  await importFile(headerInputs[0], file);
  await importFile(headerInputs[3], file);
  expect(loaders[2].loadBundleFile).toHaveBeenCalledWith(file);
  expect(loaders[2].loadMaterialBundle).toHaveBeenCalledWith(file);
  expect(loaders[0].loadBundleFile).not.toHaveBeenCalled();
  expect(loaders[0].loadMaterialBundle).not.toHaveBeenCalled();

  button(host, "单宠查看").click();
  await nextTick();
  await importFile(headerInputs[0], file);
  expect(loaders[0].loadBundleFile).toHaveBeenCalledWith(file);
});

it("shows loading progress and prevents another local import on the busy side", async () => {
  loaders[1].loading.value = true;
  loaders[1].loadingMessage.value = "正在下载精灵…";
  loaders[1].downloadProgress.value = { loaded: 512, total: 1024 };
  await nextTick();
  const [left, right] = host.querySelectorAll(".side-panel");
  expect(
    left.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
  ).toBe("50");
  expect(
    left.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
  ).toBe(true);
  expect(
    right.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
  ).toBe(false);
});

it("provides per-side retry, named download and fallback download links", async () => {
  const left = loaders[1];
  const right = loaders[2];
  const entry = {
    id: 1234,
    kind: "swf" as const,
    name: "petanimpackage_1234",
    path: "0123456789abcdef0123456789abcdef",
    fileSize: 1024,
  };
  left.remoteLoadContext.value = { entry, sharedBundles: [] };
  left.error.value = "下载失败";
  right.remoteLoadContext.value = {
    entry: { ...entry, fileSize: 30 * 1024 * 1024, mirrored: true },
    sharedBundles: [],
  };
  right.error.value = "文件过大无法下载";
  right.cdnFileTooLarge.value = true;
  await nextTick();
  const [leftPanel, rightPanel] = host.querySelectorAll(".side-panel");
  button(leftPanel, "重试").click();
  button(leftPanel, "下载 petanimpackage_1234.bundle").click();
  expect(left.retryRemoteLoad).toHaveBeenCalledOnce();
  expect(left.downloadNamedRemoteBundle).toHaveBeenCalledOnce();
  expect(right.retryRemoteLoad).not.toHaveBeenCalled();
  expect(
    rightPanel.querySelector('a[href*="raw.githubusercontent.com"]'),
  ).not.toBeNull();

  right.cdnFileTooLarge.value = false;
  right.remoteLoadContext.value.entry.mirrored = false;
  await nextTick();
  expect(rightPanel.querySelector('a[href*="newseer.61.com"]')).not.toBeNull();
  button(rightPanel, "关闭").click();
  expect(right.dismissError).toHaveBeenCalledOnce();
});
