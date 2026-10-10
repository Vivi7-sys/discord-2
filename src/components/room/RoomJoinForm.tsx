"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  cleanDisplayName,
  MAX_AVATAR_DATA_URL_LENGTH,
  type RoomProfile,
} from "@/lib/room/participant-profile";

type Props = { onJoin: (profile: RoomProfile) => void };

/** Reduz a foto antes de colocá-la no token do LiveKit. Remove metadados EXIF. */
async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.size > 5_000_000) {
    throw new Error("Escolha uma imagem JPG, PNG ou WebP de até 5 MB.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const picture = new window.Image();
    picture.src = objectUrl;
    await picture.decode();

    if (!picture.naturalWidth || !picture.naturalHeight) {
      throw new Error("Não foi possível ler a imagem.");
    }
    for (const size of [112, 96, 80, 64]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("O navegador não conseguiu preparar a foto.");
      const crop = Math.min(picture.naturalWidth, picture.naturalHeight);
      const offsetX = (picture.naturalWidth - crop) / 2;
      const offsetY = (picture.naturalHeight - crop) / 2;
      ctx.drawImage(picture, offsetX, offsetY, crop, crop, 0, 0, size, size);
      const result = canvas.toDataURL("image/jpeg", 0.7);
      if (result.length <= MAX_AVATAR_DATA_URL_LENGTH) return result;
    }
    throw new Error("Essa foto não pôde ser reduzida. Escolha outra imagem.");
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Essa foto")) throw cause;
    if (cause instanceof Error && cause.message.startsWith("O navegador")) throw cause;
    throw new Error("Não foi possível abrir a foto. Tente JPG, PNG ou WebP.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function RoomJoinForm({ onJoin }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      setAvatar(await prepareAvatar(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Foto inválida.");
    } finally {
      setProcessing(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = cleanDisplayName(displayName);
    if (!name) {
      setError("Digite um nome de 2 a 24 caracteres.");
      return;
    }
    if (processing) return;
    setError(null);
    onJoin({ displayName: name, avatar });
  }

  return (
    <main className="room-join-page">
      <Link href="/" className="back-link">← Voltar ao início</Link>
      <form className="room-join-card" onSubmit={submit}>
        <span className="room-join-eyebrow">DISCORD 2 · CONVITE</span>
        <h1>Antes de entrar na sala</h1>
        <p className="room-join-description">Escolha como seus amigos vão ver você.</p>
        <div className="room-join-photo-row">
          <span className="room-join-avatar" aria-label="Prévia da foto de perfil">
            {avatar ? (
              <Image src={avatar} alt="Foto selecionada" width={92} height={92} unoptimized />
            ) : (
              <span aria-hidden="true">{displayName.trim().charAt(0).toUpperCase() || "?"}</span>
            )}
          </span>
          <div className="room-join-photo-actions">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="room-join-file" aria-label="Escolher foto de perfil" onChange={(event) => void onFileChange(event)} />
            <button type="button" className="btn btn-secondary" disabled={processing}
              onClick={() => fileInputRef.current?.click()}>
              {processing ? "Preparando foto…" : avatar ? "Trocar foto" : "Escolher foto"}
            </button>
            {avatar && <button type="button" className="room-join-remove" onClick={() => setAvatar(null)}>Remover foto</button>}
            <span className="room-join-hint">Opcional · JPG, PNG ou WebP</span>
          </div>
        </div>
        <label className="room-join-label" htmlFor="room-join-name">Seu nome na sala</label>
        <input id="room-join-name" className="room-join-name" type="text" autoComplete="nickname"
          minLength={2} maxLength={24} required placeholder="Como quer ser chamado?"
          value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(null); }} />
        {error && <p className="room-join-error" role="alert">{error}</p>}
        <button className="btn btn-primary room-join-submit" type="submit" disabled={processing}>
          Entrar na sala <span aria-hidden="true">→</span>
        </button>
        <p className="room-join-privacy">Seu nome e sua foto ficarão visíveis para quem estiver na sala.</p>
      </form>
    </main>
  );
}
