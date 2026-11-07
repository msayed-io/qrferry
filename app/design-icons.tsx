import type { SVGProps } from "react";

const paths = {
  "up": "<path d=\"M12 15V4M8 8l4-4 4 4M6 12v6a2 2 0 002 2h8a2 2 0 002-2v-6\"/>",
  "scan": "<path d=\"M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2M8 12h8\"/>",
  "doc": "<path d=\"M14 3H8a2 2 0 00-2 2v14a2 2 0 002 2h8a2 2 0 002-2V7zM14 3v4h4M12 11v6M9 14h6\"/>",
  "folder": "<path d=\"M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z\"/>",
  "bolt": "<path d=\"M13 3L5 13h6l-1 8 8-10h-6z\"/>",
  "chev": "<path d=\"M6 9l6 6 6-6\"/>",
  "copy": "<rect x=\"9\" y=\"9\" width=\"11\" height=\"11\" rx=\"3\"/><path d=\"M5 15V7a3 3 0 013-3h8\"/>",
  "full": "<path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\"/>",
  "cam": "<path d=\"M4 8a2 2 0 012-2h1.5l1-2h7l1 2H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z\"/><circle cx=\"12\" cy=\"13\" r=\"3.5\"/>",
  "mode": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3a9 9 0 010 18z\" fill=\"currentColor\"/>",
  "monitor": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"2.5\"/><path d=\"M9 20h6M12 16v4\"/>",
  "link": "<path d=\"M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1\"/>",
  "chat": "<path d=\"M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-6l-4 3.5V17H5a2 2 0 01-2-2V7a2 2 0 012-2z\"/>",
  "qr": "<rect x=\"4\" y=\"4\" width=\"6\" height=\"6\" rx=\"1.5\"/><rect x=\"14\" y=\"4\" width=\"6\" height=\"6\" rx=\"1.5\"/><rect x=\"4\" y=\"14\" width=\"6\" height=\"6\" rx=\"1.5\"/><path d=\"M14 14h3v3M20 14v.01M14 20h.01M17 20h3v-3\"/>",
  "sendup": "<path d=\"M12 19V5M6 11l6-6 6 6\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "x": "<path d=\"M6 6l12 12M18 6L6 18\"/>",
  "ok": "<path d=\"M5 12.5l4.5 4.5L19 7.5\"/>"
} as const;

export function DesignIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
 return <svg viewBox="0 0 24 24" className="i" aria-hidden="true" {...props} dangerouslySetInnerHTML={{ __html: paths[name] }} />;
}

export function EmptyQrIcon() { return <svg className="qr" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="7" aria-hidden="true"><rect x="4" y="4" width="28" height="28" rx="8"/><rect x="64" y="4" width="28" height="28" rx="8"/><rect x="4" y="64" width="28" height="28" rx="8"/><path d="M50 8v8M50 28v4M42 50h14M70 54v10M80 64h12M50 72v20M64 84v8" strokeLinecap="round"/></svg>; }
