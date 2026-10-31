import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "D2 · Salas privadas para assistir juntos",
  description:
    "Salas privadas para assistir juntos.",
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
