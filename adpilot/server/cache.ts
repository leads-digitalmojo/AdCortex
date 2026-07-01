/**
 * Simple in-memory cache with TTL support
 * Used to cache expensive operations like Claude API calls
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

/**
 * Generate a cache key from multiple parts
 */
export function cacheKey(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p !== undefined).join("::");
}

/**
 * Get a value from cache if it exists and hasn't expired
 */
export function getCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    return null;
  }

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Set a value in cache with a TTL (in seconds)
 */
export function setCache<T>(key: string, data: T, ttlSeconds: number = 300): void {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  cache.set(key, { data, expiresAt });
}

/**
 * Delete a specific cache entry
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * Delete all cache entries matching a pattern (e.g., for a client/platform)
 */
export function invalidateCachePattern(pattern: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(pattern)) {
      cache.delete(key);
    }
  }
}

/**
 * Clear all cache entries
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): { size: number; keys: string[] } {
  // Clean up expired entries while we're at it
  const now = Date.now();
  for (const [key, entry] of Array.from(cache.entries())) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }

  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
