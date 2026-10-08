// Até a integração com LiveKit, não há lista real de participantes.
export default function ParticipantList() {
  return (
    <aside className="participants" aria-label="Participantes">
      <h2>Participantes</h2>
      <p className="participants-note">
        Ainda não há participantes conectados. Esta lista será ativada com o LiveKit.
      </p>
    </aside>
  );
}
