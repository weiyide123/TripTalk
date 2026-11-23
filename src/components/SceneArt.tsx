// Small original UI illustrations; no external image or font requests.
import type { Scene } from "@/contracts/scene";
export function SceneArt({ scene = "generic" }: { scene?: Scene["art"] }) {
  const palette = {
    hotel: ["#e7f2ef", "#ffe1b8"],
    airport: ["#e3f2fa", "#bfdcef"],
    food: ["#fff0e5", "#f7c6aa"],
    bus: ["#e9f3e8", "#b7d8bc"],
    generic: ["#e7f1fb", "#c0dff5"],
  }[scene];
  const Artwork = {
    generic: GenericArt,
    hotel: HotelArt,
    airport: AirportArt,
    food: FoodArt,
    bus: BusArt,
  }[scene];
  return (
    <svg
      className="scene-art"
      viewBox="0 0 240 150"
      fill="none"
      aria-hidden="true"
    >
      <rect
        width="240"
        height="150"
        rx="18"
        fill={palette[0]}
      />
      <circle
        cx="198"
        cy="29"
        r="15"
        fill="#fff1bf"
      />
      <path
        d="M-5 126Q53 103 117 128T248 113V155H-5Z"
        fill="#c2d8b2"
      />
      <path
        d="M26 42h34m-17-7h29m99 23h40"
        stroke="white"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <Artwork color={palette[1]} />
    </svg>
  );
}

// 各场景只负责自己的 SVG 图形，共享底色和装饰留在 SceneArt。

function GenericArt({ color }: { color: string }) {
  return (
    <g
      fill={color}
      stroke="#75a8c9"
      strokeWidth="4"
    >
      <path d="M65 50h110v55H105l-25 18v-18H65z" />
      <path
        d="M88 70h64m-64 16h45"
        strokeLinecap="round"
      />
    </g>
  );
}

function HotelArt({ color }: { color: string }) {
  return (
    <g>
      <rect
        x="57"
        y="32"
        width="128"
        height="107"
        rx="5"
        fill={color}
      />
      <path
        d="M51 33h140"
        stroke="#e2ae87"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {[70, 101, 132, 163].map((x) => (
        <g key={x}>
          <rect
            x={x}
            y="44"
            width="13"
            height="21"
            rx="2"
            fill="#9dc6ce"
          />
          <path
            d={`M${x + 6.5} 44v21`}
            stroke="#fff8e9"
            strokeWidth="2"
          />
        </g>
      ))}
      <rect
        x="83"
        y="82"
        width="75"
        height="57"
        fill="#b4cdd1"
      />
      <rect
        x="99"
        y="93"
        width="42"
        height="46"
        fill="#8fafa9"
      />
      <path
        d="M120 94v45M100 116h40"
        stroke="#f4e1c6"
        strokeWidth="3"
      />
      <path
        d="M73 79h96l-9 16H82Z"
        fill="#e89972"
      />
      <rect
        x="91"
        y="70"
        width="58"
        height="17"
        rx="8"
        fill="#d88160"
      />
      <text
        x="120"
        y="82"
        fill="white"
        fontSize="10"
        textAnchor="middle"
        fontFamily="sans-serif"
        fontWeight="700"
      >
        HOTEL
      </text>
      <path
        d="M85 95v44m74-44v44"
        stroke="#e4ba95"
        strokeWidth="5"
      />
      {[37, 204].map((x) => (
        <g key={x}>
          <path
            d={`M${x} 100v40`}
            stroke="#a78b65"
            strokeWidth="5"
          />
          <circle
            cx={x}
            cy="95"
            r="16"
            fill="#9cbd77"
          />
          <circle
            cx={x - 5}
            cy="106"
            r="15"
            fill="#8db675"
          />
        </g>
      ))}
    </g>
  );
}

function AirportArt() {
  return (
    <g>
      <path
        d="M31 133V83h22v50M25 73h34l-4 15H29Z"
        fill="#8eb8cb"
      />
      <rect
        x="38"
        y="52"
        width="8"
        height="23"
        fill="#8eb8cb"
      />
      <path
        d="M67 133v-26q47-48 100 0v26"
        fill="#b2d3e1"
      />
      <path
        d="m105 70 85-27-38 28-14 27-8-21-25-7Z"
        fill="#fffdf8"
        stroke="#94b9cb"
        strokeWidth="2"
      />
      <path
        d="M75 112h82m-62-7v28m25-37v37m25-27v27"
        stroke="#edf6f8"
        strokeWidth="4"
      />
    </g>
  );
}

function FoodArt() {
  return (
    <g>
      <rect
        x="49"
        y="67"
        width="143"
        height="71"
        fill="#f2d3ac"
      />
      <path
        d="M44 51h153l7 24H37Z"
        fill="#edaa8a"
      />
      {[48, 78, 108, 138, 168].map((x) => (
        <path
          key={x}
          d={`M${x} 51h15l4 24h-23Z`}
          fill="#fff8e9"
        />
      ))}
      <rect
        x="62"
        y="85"
        width="48"
        height="43"
        rx="3"
        fill="#a6c7bb"
      />
      <rect
        x="130"
        y="85"
        width="43"
        height="53"
        fill="#acbdaf"
      />
      <ellipse
        cx="120"
        cy="127"
        rx="38"
        ry="11"
        fill="#faf6e9"
      />
      <ellipse
        cx="120"
        cy="124"
        rx="26"
        ry="8"
        fill="#e5a579"
      />
      <circle
        cx="110"
        cy="121"
        r="4"
        fill="#94b779"
      />
      <circle
        cx="127"
        cy="123"
        r="4"
        fill="#94b779"
      />
    </g>
  );
}

function BusArt() {
  return (
    <g>
      <path
        d="M0 136h240"
        stroke="#aebcbd"
        strokeWidth="18"
      />
      <rect
        x="74"
        y="74"
        width="118"
        height="52"
        rx="10"
        fill="#7eb4d1"
      />
      <rect
        x="84"
        y="82"
        width="77"
        height="23"
        rx="3"
        fill="#e5f2f4"
      />
      <rect
        x="169"
        y="82"
        width="15"
        height="36"
        rx="3"
        fill="#d7e9e9"
      />
      <circle
        cx="97"
        cy="128"
        r="9"
        fill="#65787d"
      />
      <circle
        cx="169"
        cy="128"
        r="9"
        fill="#65787d"
      />
      <path
        d="M45 57v73"
        stroke="#819e9b"
        strokeWidth="4"
      />
      <rect
        x="32"
        y="50"
        width="26"
        height="24"
        rx="5"
        fill="#8fb8cb"
      />
      <path
        d="M39 61h12"
        stroke="white"
        strokeWidth="3"
      />
    </g>
  );
}
