export interface ViewerWarningLink {
  message: string;
  href: string;
}

export type ViewerWarning = string | ViewerWarningLink;

export function isViewerWarningLink(
  warning: ViewerWarning,
): warning is ViewerWarningLink {
  return typeof warning === "object" && warning !== null && "href" in warning;
}
