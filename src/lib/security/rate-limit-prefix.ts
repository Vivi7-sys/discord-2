/** Só o processo de integração define essa variável; salas e cotas reais ficam intactas. */
export function rateLimitPrefix(suffix: string): string {
  const run = process.env.DISCORD2_INTEGRATION_RUN;
  if (!run) return `discord2:rate:${suffix}`;
  if (!/^[a-f0-9]{32}$/.test(run)) throw new Error("Invalid integration namespace");
  return `discord2:integration:${run}:rate:${suffix}`;
}
