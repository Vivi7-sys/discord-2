/** Confirma um token Turnstile diretamente com o Cloudflare. */
export async function verifyTurnstileToken(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token || token.length > 2048) {
    return false;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          secret,
          response: token,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(7000),
      }
    );

    if (!response.ok) return false;

    const result: { success?: boolean } = await response.json();
    return result?.success === true;
  } catch {
    return false;
  }
}
