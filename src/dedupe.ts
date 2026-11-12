/** Texts that differ only in case or whitespace compare equal under this key. */
export const textKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Keep the first item for each key, comparing keys with `textKey`. */
export function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = textKey(key(i));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
