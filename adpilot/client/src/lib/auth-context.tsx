import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "blocked";
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

interface AuthResponse {
  authenticated: boolean;
  user?: AuthUser;
  bootstrap?: {
    email: string;
    passwordIsDefault: boolean;
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  bootstrapEmail: string;
  bootstrapPasswordIsDefault: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AUTH_QUERY_KEY = ["/api/auth/me"];
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isMutating, setIsMutating] = useState(false);

  const { data, isLoading, refetch } = useQuery<AuthResponse>({
    queryKey: AUTH_QUERY_KEY,
  });

  const value = useMemo<AuthContextValue>(() => ({
    user: data?.authenticated ? data.user || null : null,
    isAuthenticated: !!data?.authenticated,
    isAdmin: data?.user?.role === "admin",
    isLoading: isLoading || isMutating,
    bootstrapEmail: data?.bootstrap?.email || "admin@adpilot.local",
    bootstrapPasswordIsDefault: !!data?.bootstrap?.passwordIsDefault,
    login: async (email: string, password: string) => {
      setIsMutating(true);
      try {
        await apiRequest("POST", "/api/auth/login", { email, password });
        await queryClient.invalidateQueries();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const result = await refetch();
          if (result.data?.authenticated) return;
          await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        }

        throw new Error(
          "Login succeeded, but the session did not stick. Check Render cookie settings and confirm the bootstrap credentials match the stored admin account.",
        );
      } finally {
        setIsMutating(false);
      }
    },
    logout: async () => {
      setIsMutating(true);
      try {
        await apiRequest("POST", "/api/auth/logout");
        await queryClient.clear();
        await refetch();
      } finally {
        setIsMutating(false);
      }
    },
    refreshAuth: async () => {
      await refetch();
    },
  }), [data, isLoading, isMutating, queryClient, refetch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
