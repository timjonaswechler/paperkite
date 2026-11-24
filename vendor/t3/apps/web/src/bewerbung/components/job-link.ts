export function normalizeJobLink(input: string): string | null {
  const value = input.trim().replace(/^quelle:\s*/i, "");
  if (!/^https?:\/\/\S+$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
