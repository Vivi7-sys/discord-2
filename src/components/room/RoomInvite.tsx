"use client";

import { useState } from "react";

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
      <button type="button" className="btn btn-secondary" onClick={copyLink}>
        Copiar link da sala
      </button>
      <span className="invite-message" role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
