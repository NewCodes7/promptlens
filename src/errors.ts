/**
 * The message of a thrown value. `catch` hands over `unknown`, and a library or a rejected
 * promise can throw a string or an object, so `(err as Error).message` could print "undefined".
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
