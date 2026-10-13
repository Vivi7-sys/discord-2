/** Limita bytes durante a leitura, inclusive sem Content-Length. */
export class RequestBodyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function readRequestJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.split(";")[0].trim().toLowerCase().endsWith("/json")) {
    throw new RequestBodyError("Envie um corpo JSON.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) {
    throw new RequestBodyError("Solicitação muito grande.", 413);
  }
  if (!request.body) throw new RequestBodyError("Solicitação inválida.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError("Solicitação muito grande.", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    if (cause instanceof RequestBodyError) throw cause;
    throw new RequestBodyError("Solicitação inválida.", 400);
  } finally {
    reader.releaseLock();
  }
}
