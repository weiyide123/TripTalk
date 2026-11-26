import type { CSSProperties } from "react";
const paths = {
  speaker: "M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  microphone:
    "M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0V6Zm-3 5v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8",
  stop: "M6 6h12v12H6Z",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  arrowUp: "M12 20V4m-6 6 6-6 6 6",
  back: "M20 12H5m6-6-6 6 6 6",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  book: "M12 5v16M12 5C8 2 3 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-4-2-7-1-10 1",
  case: "M8 6V3h8v3M4 7h16v14H4ZM8 7v14M16 7v14M2 12h20",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  sparkles:
    "M9 5c.8 4.8 2.2 6.2 7 7-4.8.8-6.2 2.2-7 7-.8-4.8-2.2-6.2-7-7 4.8-.8 6.2-2.2 7-7ZM19 2v6m-3-3h6",
  thumbsUp:
    "M7 10v11H3V10h4Zm0 0 5-8a3 3 0 0 1 3 3v4h4a2 2 0 0 1 2 2.4l-1.5 7A3 3 0 0 1 16.6 21H7",
  bulb: "M9 19h6m-5 3h4M8 15a7 7 0 1 1 8 0l-1 2H9Z",
  check: "m5 12 4 4L20 5",
  pause: "M8 5v14M16 5v14",
  copy: "M9 9h12v12H9ZM15 9V3H3v12h6",
  bookmark: "M6 3h12v18l-6-4-6 4Z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  chevronDown: "m6 9 6 6 6-6",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-10h.01",
  close: "m6 6 12 12M6 18 18 6",
  lock: "M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4",
  send: "m3 3 19 9-19 9 4-9Zm4 9h15",
  refresh: "M20 7A9 9 0 1 0 21 16M20 2v6h-6",
  pencil: "m16 3 5 5M3 21l5-1L21 7a2.8 2.8 0 0 0-4-4L4 16l-1 5Z",
  chevron: "m8 5 7 7-7 7",
  heart: "M20 5c-3-3-7-1-8 1-2-3-6-3-8-1-4 4 1 10 8 15 7-5 12-11 8-15Z",
} as const;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
