/**
 * Strip a reference prefix and return the suffix (e.g. "users/123" -> "123").
 * If ref does not start with prefix, returns ref unchanged.
 */
export function idFromRef(ref: string, prefix: string): string {
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}
