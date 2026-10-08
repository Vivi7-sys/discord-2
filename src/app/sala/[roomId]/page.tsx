import type { Metadata } from "next";
import { Suspense } from "react";
import RoomScreen from "@/components/room/RoomScreen";

export const metadata: Metadata = {
  title: "Sala · Screen Share",
};

type SalaPageProps = {
  params: Promise<{ roomId: string }>;
};

// Evita erro caso o texto da URL tenha uma codificação inválida.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// O ID da sala vem da URL (o trecho [roomId] da pasta). Ler esse valor é um
// dado "de requisição": só se conhece quando alguém abre a página.
// Com Cache Components ligado, esse acesso precisa ficar dentro de <Suspense>.
// Sem Cache Components o <Suspense> é inofensivo, então o código serve nos dois casos.
async function RoomContent({ params }: SalaPageProps) {
  const { roomId } = await params;
  return <RoomScreen roomId={safeDecode(roomId)} />;
}

export default function SalaPage({ params }: SalaPageProps) {
  return (
    <Suspense
      fallback={
        <main className="room">
          <p className="loading">Carregando sala…</p>
        </main>
      }
    >
      <RoomContent params={params} />
    </Suspense>
  );
}
