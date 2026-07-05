const PAGE_LINE = /\.png$/i;
const COORD_KEYS = new Set([
  "size",
  "bounds",
  "offsets",
  "xy",
  "orig",
  "offset",
  "split",
  "pad",
]);

function scaleCoordLine(line: string, scale: number): string {
  if (scale === 1) return line;
  const colon = line.indexOf(":");
  if (colon < 0) return line;
  const key = line.slice(0, colon).trim();
  if (!COORD_KEYS.has(key)) return line;
  const values = line
    .slice(colon + 1)
    .split(",")
    .map((part) => Math.round(Number(part.trim()) * scale));
  if (values.some((value) => Number.isNaN(value))) return line;
  return `${key}:${values.join(",")}`;
}

function scalePageBlock(block: string, scale: number): string {
  if (scale === 1) return block;
  const eol = block.includes("\r\n") ? "\r\n" : "\n";
  return block
    .split(/\r?\n/)
    .map((line) => scaleCoordLine(line, scale))
    .join(eol);
}

function splitAtlasPages(atlasText: string): Array<{ name: string; block: string }> {
  const eol = atlasText.includes("\r\n") ? "\r\n" : "\n";
  const lines = atlasText.split(/\r?\n/);
  const pages: Array<{ name: string; block: string }> = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentName === null) return;
    pages.push({
      name: currentName,
      block: currentLines.join(eol),
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (PAGE_LINE.test(trimmed)) {
      flush();
      currentName = trimmed;
      currentLines = [line];
      continue;
    }
    if (currentName !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return pages;
}

/** 按纹理页缩放 Spine atlas 文本中的像素坐标 */
export function scaleSpineAtlasText(
  atlasText: string,
  pageScales: Map<string, number>,
): string {
  if (pageScales.size === 0) return atlasText;
  const pages = splitAtlasPages(atlasText);
  if (pages.length === 0) return atlasText;
  const eol = atlasText.includes("\r\n") ? "\r\n" : "\n";
  return pages
    .map((page) => {
      const scale = pageScales.get(page.name) ?? 1;
      return scalePageBlock(page.block, scale);
    })
    .join(eol);
}
