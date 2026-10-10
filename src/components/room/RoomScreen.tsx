"use client";

import { useState } from "react";
import LiveKitRoomConnection from "./LiveKitRoomConnection";
import RoomJoinForm from "./RoomJoinForm";
import type { RoomProfile } from "@/lib/room/participant-profile";

// Só solicita o token e conecta ao LiveKit após a escolha do nome e da foto.
export default function RoomScreen({ roomId }: { roomId: string }) {
  const [profile, setProfile] = useState<RoomProfile | null>(null);
  if (!profile) return <RoomJoinForm onJoin={setProfile} />;
  return <LiveKitRoomConnection roomId={roomId} profile={profile} />;
}
