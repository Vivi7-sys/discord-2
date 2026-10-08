import Link from "next/link";
import ParticipantList from "./ParticipantList";
import RoomControls from "./RoomControls";
import StreamArea from "./StreamArea";

type RoomScreenProps = {
  roomId: string;
};

// Monta a tela da sala juntando as três peças: área do vídeo, lista de
// participantes e barra de controles.
// Fase 1: só visual. Nenhuma conexão real acontece aqui.
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
          Desconectado · visual de exemplo
        </span>
      </header>

      <div className="room-layout">
        <StreamArea />
        <ParticipantList />
      </div>

      <RoomControls />
    </main>
  );
}
