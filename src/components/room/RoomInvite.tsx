"use client";

import { useState } from "react";
import RoomIcon from "./RoomIcon";

type RoomInviteProps = { roomId: string };

/** Copia o endereço atual. Não cria convites nem permissões no servidor. */
export default function RoomInvite({ roomId }: RoomInviteProps) {
  const [message, setMessage] = useState("");

  async function copyLink() {
    const link = `${window.location.origin}/sala/${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Link copiado!");
    } catch {
      setMessage("Não foi possível copiar automaticamente. Copie o endereço da barra do navegador.");
    }
  }

  return (
    <div className="invite">
      <div className="invite-action">
        <button type="button" className="room-copy-btn" onClick={copyLink} title="Copiar link da sala">
          <RoomIcon name="copy" size={16} /> Copiar link
        </button>
        <span className="invite-message" role="status" aria-live="polite">
          {message}
        </span>
      </div>
    </div>
  );
}
