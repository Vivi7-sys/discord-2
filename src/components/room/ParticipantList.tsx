type Participant = {
  id: string;
  name: string;
  role: "Transmissor" | "Espectador";
};

// Dados de exemplo só para desenhar a tela. Nada aqui é real.
// Nas próximas fases esta lista virá da conexão com o LiveKit.
const SAMPLE_PARTICIPANTS: Participant[] = [
  { id: "1", name: "Você (exemplo)", role: "Transmissor" },
  { id: "2", name: "Amigo 1 (exemplo)", role: "Espectador" },
  { id: "3", name: "Amigo 2 (exemplo)", role: "Espectador" },
];

export default function ParticipantList() {
  return (
    <aside className="participants" aria-label="Participantes">
      <h2>Participantes</h2>
      <p className="participants-note">Dados de exemplo, nada real.</p>
      <ul>
        {SAMPLE_PARTICIPANTS.map((participant) => (
          <li key={participant.id} className="participant">
            <span className="avatar" aria-hidden="true">
              {participant.name.charAt(0)}
            </span>
            <span>
              <span className="participant-name">{participant.name}</span>
              <span className="participant-role">{participant.role}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
