"use client";

import { useId, useState } from "react";

type ParticipantItem = {
  id: string;
  label: string;
  isLocal: boolean;
};

type ParticipantListProps = {
  participants: ParticipantItem[];
  phase: "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
  sharingId: string | null;
};

export default function ParticipantList({ participants, sharingId }: ParticipantListProps) {
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const detailsId = useId();

  return (
    <aside className="participants" aria-label="Participantes">
      <div className="participants-heading">
        <h2>Participantes ({participants.length})</h2>
        <button
          type="button"
          className="participants-toggle"
          aria-expanded={mobileListOpen}
          aria-controls={detailsId}
          onClick={() => setMobileListOpen((open) => !open)}
        >
          {mobileListOpen ? "Ocultar lista" : "Mostrar lista"}
        </button>
      </div>
      <div id={detailsId} className={`participants-details${mobileListOpen ? " participants-details-open" : ""}`}>
        {participants.length > 0 && (
          <ul>
            {participants.map((participant) => (
              <li className="participant" key={participant.id}>
                <span className="avatar" aria-hidden="true">
                  {participant.isLocal ? "V" : "P"}
                </span>
                <div>
                  <strong className="participant-name">{participant.label}</strong>
                  <span className="participant-role">
                    {participant.id === sharingId ? "Transmitindo a tela" : "Espectador"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
