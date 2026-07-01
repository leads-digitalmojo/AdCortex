import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";

/**
 * A wrapper around TanStack useQuery that automatically injects
 * the active clientId and platform into the query key and API requests.
 * 
 * Ensures consistent 'api' pattern and helps prevent 'undefined' reference errors.
 */
export function useAdQuery<T>(
  endpoint: string,
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">
) {
  const { activeClientId, activePlatform } = useClient();

  // Standardized query key: [endpoint, clientId, platform]
  const queryKey = [endpoint, activeClientId, activePlatform];

  return useQuery<T>({
    ...options,
    queryKey,
    queryFn: async () => {
      if (!activeClientId || !activePlatform) {
        throw new Error(`useAdQuery failed: activeClientId or activePlatform is undefined. Endpoint: ${endpoint}`);
      }
      
      const res = await apiRequest("GET", `${endpoint}/${activeClientId}/${activePlatform}`);
      return res.json();
    },
    enabled: (options?.enabled !== false) && !!activeClientId && !!activePlatform,
  });
}
