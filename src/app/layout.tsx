import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Screen Share · compartilhamento de tela privado",
  description:
    "Sistema privado de compartilhamento de tela, com áudio, para um grupo pequeno de amigos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
