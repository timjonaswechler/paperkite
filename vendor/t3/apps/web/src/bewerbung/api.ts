import * as Schema from "effect/Schema";
export const base = "/bewerbung/api";
export class ApiError extends Schema.TaggedError<ApiError>()("BewerbungApiError", {
  message: Schema.String,
  status: Schema.Number,
}) {}
export const isApiError = Schema.is(ApiError);
export async function api<T = unknown>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  keepalive = false,
): Promise<T> {
  const response = await fetch(base + url, {
    method,
    ...(signal ? { signal } : {}),
    keepalive,
    headers:
      method === "GET" ? {} : { "Content-Type": "application/json", "X-Bewerbung-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError({
      message: data.error || response.statusText,
      status: response.status,
    });
  return data as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export async function textFile(url: string): Promise<string> {
  const response = await fetch(base + url);
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  return response.text();
}

export async function sourceFile(url: string): Promise<{ text: string; revision: number }> {
  const response = await fetch(base + url);
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  const revision = Number(response.headers.get("X-Bewerbung-Revision"));
  requireBusiness(
    Number.isSafeInteger(revision) && revision > 0,
    "Quellenversion fehlt. Bitte neu laden.",
  );
  return { text: await response.text(), revision };
}

// React Compiler cannot lower throw statements inside handlers' try blocks.
export function requireBusiness(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
