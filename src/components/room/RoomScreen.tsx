import LiveKitRoomConnection from "./LiveKitRoomConnection";

// A página continua recebendo o ID validado pelo servidor.
// A conexão com o LiveKit acontece apenas no navegador.
export default function RoomScreen({ roomId }: { roomId: string }) {
  return <LiveKitRoomConnection roomId={roomId} />;
}
