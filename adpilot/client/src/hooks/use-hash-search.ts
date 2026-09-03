import { useCallback, useSyncExternalStore } from "react";

/**
 * This app routes via wouter's `useHashLocation` (App.tsx: `<Router hook={useHashLocation}>`),
 * which puts the ENTIRE path and query string after the `#` — e.g. `#/campaigns?filter=branded`.
 * `document.location.search` is therefore always "" here, and `useHashLocation` doesn't expose
 * the `.searchHook` static wouter looks for (see wouter/src/index.js:165), so it silently falls
 * back to the browser-history searchHook, which reads `location.search`. Any code calling
 * wouter's `useSearch()` in this app gets "" forever, no matter what's actually in the URL.
 *
 * These are the hash-aware replacements. Read with useHashSearch(); read+write a single param
 * with useHashSearchParam().
 */

function currentHashSearch(): string {
  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  return qIndex === -1 ? "" : hash.slice(qIndex + 1);
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useHashSearch(): string {
  return useSyncExternalStore(subscribe, currentHashSearch, () => "");
}

/**
 * Two-way binding for a single query param inside the hash, e.g. reading/writing
 * `filter` in `#/campaigns?filter=branded`. Value changes replace the current history
 * entry (no back-button spam from filter clicks) and fall back to `defaultValue` when
 * the param is absent — setting back to `defaultValue` removes the param from the URL
 * rather than writing it explicitly, keeping the URL clean when nothing is filtered.
 */
export function useHashSearchParam(key: string, defaultValue: string): [string, (next: string) => void] {
  const search = useHashSearch();
  const value = new URLSearchParams(search).get(key) ?? defaultValue;

  const setValue = useCallback((next: string) => {
    const hash = window.location.hash || "";
    const qIndex = hash.indexOf("?");
    const path = qIndex === -1 ? hash : hash.slice(0, qIndex);
    const params = new URLSearchParams(qIndex === -1 ? "" : hash.slice(qIndex + 1));

    if (!next || next === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, next);
    }

    const nextSearch = params.toString();
    const nextHash = nextSearch ? `${path}?${nextSearch}` : path;
    if (window.location.hash === nextHash) return;

    // history.replaceState + a manual dispatch (not wouter's own `navigate`, whose
    // use-hash-location.js implementation puts the "?..." into the real document
    // search instead of keeping it inside the hash — see the module docstring above)
    // so a filter click updates the URL without adding a back-button history entry.
    // wouter's own hashchange listener ignores the event payload, so a bare Event works.
    history.replaceState(history.state, "", nextHash);
    window.dispatchEvent(new Event("hashchange"));
  }, [key, defaultValue]);

  return [value, setValue];
}
