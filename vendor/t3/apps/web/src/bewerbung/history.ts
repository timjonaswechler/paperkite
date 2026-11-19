type IdentifiedEvent = { id: number; type: string };

export function mergeEvents<T extends IdentifiedEvent>(history: T[], live: T[]): T[] {
  const events = new Map<number, T>();
  for (const event of [...history, ...live])
    if (event.type !== "delta") events.set(event.id, event);
  return [...events.values()].sort((a, b) => a.id - b.id);
}

export async function loadHistory<T extends IdentifiedEvent>(
  fetchPage: (after: number) => Promise<T[]>,
  active: () => boolean = () => true,
): Promise<T[]> {
  const history: T[] = [];
  let after = 0;
  while (active()) {
    const page = await fetchPage(after);
    if (!active() || page.length === 0) break;
    const last = page.at(-1);
    if (!last) break;
    const next = last.id;
    if (!Number.isSafeInteger(next) || next <= after)
      throw new Error("Ungültige Verlaufsseite: Cursor bewegt sich nicht weiter.");
    history.push(...page.filter((event) => event.type !== "delta"));
    after = next;
  }
  return mergeEvents(history, []);
}
