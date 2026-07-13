import type { PetAnimIndexEntry } from "./pet-anim-index";

export interface PetDeepLink {
  petId: number;
  kind?: "swf" | "spine";
  variant?: "small";
}

const PPETS_RE = /^ppets_(\d+)(_small)?$/i;
const SPINE_RE = /^pskilltimeline_spines_(\d+)$/i;

/** 从查询字符串解析精灵深链接参数（支持 `?pet=1234` 及 bundle 命名） */
export function parsePetDeepLink(search = ""): PetDeepLink | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const raw = params.get("pet")?.trim();
  if (!raw) return null;

  const kindParam = params.get("kind")?.trim().toLowerCase();
  const variantParam = params.get("variant")?.trim().toLowerCase();

  const kind =
    kindParam === "swf" || kindParam === "spine" ? kindParam : undefined;
  const variant = variantParam === "small" ? "small" : undefined;

  if (/^\d+$/.test(raw)) {
    return { petId: Number(raw), kind, variant };
  }

  const ppetsMatch = raw.match(PPETS_RE);
  if (ppetsMatch) {
    return {
      petId: Number(ppetsMatch[1]),
      kind: kind ?? "swf",
      variant: variant ?? (ppetsMatch[2] ? "small" : undefined),
    };
  }

  const spineMatch = raw.match(SPINE_RE);
  if (spineMatch) {
    return {
      petId: Number(spineMatch[1]),
      kind: kind ?? "spine",
    };
  }

  return null;
}

function entryScore(entry: PetAnimIndexEntry): number {
  if (entry.kind === "spine") return 0;
  if (entry.kind === "swf" && entry.variant !== "small") return 1;
  if (entry.kind === "swf" && entry.variant === "small") return 2;
  return 3;
}

/** 在索引条目中查找与深链接匹配的精灵（默认优先 Spine） */
export function findPetIndexEntry(
  entries: PetAnimIndexEntry[],
  link: PetDeepLink,
): PetAnimIndexEntry | null {
  const matches = entries.filter((entry) => entry.id === link.petId);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  const filtered = matches.filter((entry) => {
    if (link.kind && entry.kind !== link.kind) return false;
    if (link.variant === "small") return entry.variant === "small";
    if (link.variant === undefined && link.kind === "swf") {
      return entry.variant !== "small";
    }
    return true;
  });

  const pool = filtered.length > 0 ? filtered : matches;
  return [...pool].sort((a, b) => entryScore(a) - entryScore(b))[0] ?? null;
}

export interface BuildPetDeepLinkUrlOptions {
  kind?: "swf" | "spine";
  variant?: "small";
  /** 默认使用当前页面的 origin 与 pathname */
  location?: Pick<Location, "origin" | "pathname">;
}

/** 基于当前站点路径生成带精灵 id 查询参数的深链接 */
export function buildPetDeepLinkUrl(
  petId: number,
  options: BuildPetDeepLinkUrlOptions = {},
): string {
  const loc =
    options.location ??
    (typeof window !== "undefined" ? window.location : undefined);
  const url = new URL(loc ? `${loc.origin}${loc.pathname}` : "https://localhost/");
  url.searchParams.set("pet", String(petId));
  if (options.kind) url.searchParams.set("kind", options.kind);
  if (options.variant === "small") url.searchParams.set("variant", "small");
  return url.toString();
}
