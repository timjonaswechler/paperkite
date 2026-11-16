export const base = "/bewerbung/api";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  keepalive = false,
): Promise<T> {
  const response = await fetch(base + url, {
    method,
    signal,
    keepalive,
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Bewerbung-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || response.statusText, response.status);
  return data as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export async function textFile(url: string): Promise<string> {
  const response = await fetch(base + url);
  if (!response.ok)
    throw new Error((await response.json()).error || response.statusText);
  return response.text();
}
