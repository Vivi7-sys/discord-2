import { connection } from "next/server";

// GET /api/health
// Rota de teste: confirma que o backend do Next.js está de pé.
export async function GET() {
  // Marca a resposta como "feita na hora do pedido". Sem isso, o Next.js
  // poderia gerar o JSON uma única vez no build e repetir sempre o mesmo horário.
  await connection();

  return Response.json(
    {
      status: "ok",
      service: "screen-share",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
