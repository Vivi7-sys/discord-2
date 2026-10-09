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

export default function ParticipantList({ participants, phase, sharingId }: ParticipantListProps) {
  return (
    <aside className="participants" aria-label="Participantes">
      <h2>Participantes ({participants.length})</h2>
      <p className="participants-note">
        {phase === "connected"
          ? sharingId
            ? "Há uma transmissão na sala. O áudio pode ser ativado nos controles de reprodução."
            : "Pessoas conectadas agora. Aguardando alguém compartilhar a tela."
          : "A lista aparecerá quando a conexão estiver ativa."}
      </p>
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
    </aside>
  );
}
