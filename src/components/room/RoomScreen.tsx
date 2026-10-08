import Link from "next/link";
import ParticipantList from "./ParticipantList";
import RoomControls from "./RoomControls";
import StreamArea from "./StreamArea";
import RoomInvite from "./RoomInvite";

type RoomScreenProps = {
  roomId: string;
};

// Monta a tela da sala juntando as três peças: área do vídeo, lista de
// participantes e barra de controles.
// Fase 2: cada URL identifica uma sala visual, ainda sem conexão real.
export default function RoomScreen({ roomId }: RoomScreenProps) {
  return (
    <main className="room">
      <header className="room-header">
        <div>
          <Link href="/" className="back-link">
            ← Início
          </Link>
          <h1 className="room-title">
            Sala <code>{roomId}</code>
          </h1>
        </div>
        <span className="status">
          <span className="status-dot" aria-hidden="true" />
          Sem conexão · Fase 2
        </span>
      </header>

      <div className="room-layout">
        <StreamArea />
        <ParticipantList />
      </div>

      <RoomInvite roomId={roomId} />
      <RoomControls />
    </main>
  );
}
