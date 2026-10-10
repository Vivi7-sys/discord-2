import type { ReactNode } from "react";

export type RoomIconName =
  | "copy" | "request" | "share" | "play" | "stop" | "cancel"
  | "settings" | "theater" | "maximize" | "minimize";

/** Ícones leves em SVG: nenhum pacote novo ou imagem externa. */
export default function RoomIcon({ name, size = 20 }: { name: RoomIconName; size?: number }) {
  const shapes: Record<RoomIconName, ReactNode> = {
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    request: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
    share: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 20v-9m-4 4 4-4 4 4" /></>,
    // Play no desenho do player do YouTube (grid de 36 x 36).
    play: <path d="M11,10 L18,13.74 18,22.28 11,26 M18,13.74 L26,18 26,18 18,22.28" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    cancel: <path d="M6 6l12 12M18 6 6 18" />,
    settings: <><path d="M12 2 13.4 4.2l2.4.3.9 2.3 2.4.9-.3 2.4L21 12l-2.2 1.9.3 2.4-2.4.9-.9 2.3-2.4.3L12 22l-1.4-2.2-2.4-.3-.9-2.3-2.4-.9.3-2.4L3 12l2.2-1.9-.3-2.4 2.4-.9.9-2.3 2.4-.3Z" /><circle cx="12" cy="12" r="3" /></>,
    // Contorno vazado retangular usado no modo teatro do YouTube.
    theater: <path fillRule="evenodd" d="m 28,11 0,14 -20,0 0,-14 z m -18,2 16,0 0,10 -16,0 0,-10 z" />,
    // Quatro cantos retos do controle de tela cheia do YouTube.
    maximize: <>
      <path d="m 10,16 2,0 0,-4 4,0 0,-2 L 10,10 l 0,6 0,0 z" />
      <path d="m 20,10 0,2 4,0 0,4 2,0 L 26,10 l -6,0 0,0 z" />
      <path d="m 24,24 -4,0 0,2 L 26,26 l 0,-6 -2,0 0,4 0,0 z" />
      <path d="M 12,20 10,20 10,26 l 6,0 0,-2 -4,0 0,-4 0,0 z" />
    </>,
    // Versão recolher: os cantos apontam para dentro ao sair da tela cheia.
    minimize: <>
      <path d="M10 16h6v-2h-4v-4h-2z" />
      <path d="M20 16h6v-6h-2v4h-4z" />
      <path d="M20 20h4v4h2v-6h-6z" />
      <path d="M10 20v6h6v-2h-4v-4z" />
    </>,
  };

  // Os SVGs de player usam o grid original 36x36; os demais continuam 24x24.
  const youtubePlayerIcon = name === "play" || name === "theater" ||
    name === "maximize" || name === "minimize";

  return (
    <svg aria-hidden="true" focusable="false"
      width={youtubePlayerIcon ? 36 : size} height={youtubePlayerIcon ? 36 : size}
      viewBox={youtubePlayerIcon ? "0 0 36 36" : "0 0 24 24"}
      style={youtubePlayerIcon ? { width: 36, height: 36 } : undefined}
      fill={youtubePlayerIcon ? "currentColor" : "none"}
      stroke={youtubePlayerIcon ? "none" : "currentColor"}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {shapes[name]}
    </svg>
  );
}
