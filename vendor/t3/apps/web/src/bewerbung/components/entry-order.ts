export type OrderedEntry = { id: string; included?: boolean };

export function prependEntry<T extends OrderedEntry>(entries: T[], entry: T): T[] {
  return [entry, ...entries];
}

export function moveEntry<T extends OrderedEntry>(entries: T[], id: string, index: number): T[] {
  const at = entries.findIndex((entry) => entry.id === id);
  if (at < 0 || !Number.isInteger(index)) return entries;
  const target = Math.max(0, Math.min(index, entries.length - 1));
  if (at === target) return entries;
  const next = [...entries];
  const [entry] = next.splice(at, 1);
  next.splice(target, 0, entry!);
  return next;
}

// Undo ordering only: retain current content, keep new entries, never resurrect deletions.
export function restoreEntryOrder<T extends OrderedEntry>(entries: T[], ids: string[]): T[] {
  const known = new Set(ids),
    current = new Map(entries.map((entry) => [entry.id, entry]));
  return [
    ...entries.filter((entry) => !known.has(entry.id)),
    ...ids.flatMap((id) => {
      const entry = current.get(id);
      return entry ? [entry] : [];
    }),
  ];
}
