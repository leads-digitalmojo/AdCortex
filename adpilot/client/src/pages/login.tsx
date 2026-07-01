import { useEffect, useState } from "react";
import { ShieldCheck, LockKeyhole, UserCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import logo from "../assets/logo.png";


export default function LoginPage() {
  const { login, isLoading, bootstrapEmail, bootstrapPasswordIsDefault } = useAuth();
  const [email, setEmail] = useState(bootstrapEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setEmail((current) => current || bootstrapEmail);
  }, [bootstrapEmail]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_35%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted))/0.55)] flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border/60 shadow-2xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-4">
            <img 
              src={logo} 
              alt="Mojo Logo" 
              className="h-12 w-12 rounded-xl shadow-lg border border-border/40" 
            />
            <div>
              <CardTitle>Mojo Performance Agent</CardTitle>
              <CardDescription>Sign in with an approved account to open the workspace.</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-xs">Protected</Badge>
            <span>Blocked users cannot log in.</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Email</label>
              <div className="relative">
                <UserCircle2 className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="you@example.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Password</label>
              <div className="relative">
                <LockKeyhole className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  placeholder="Enter your password"
                />
              </div>
            </div>
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                {error.replace(/^\d+:\s*/, "")}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>Bootstrap admin: <span className="text-foreground">{bootstrapEmail}</span></p>
            <p>
              {bootstrapPasswordIsDefault
                ? "Using the default bootstrap password from local config. Change it after first login."
                : "Bootstrap password is coming from your environment configuration."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
