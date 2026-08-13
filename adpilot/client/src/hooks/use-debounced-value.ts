import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates `delayMs` after the
 * last change. Use for search inputs that drive expensive filtering/sorting
 * over large arrays, so every keystroke doesn't trigger a full recompute.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
