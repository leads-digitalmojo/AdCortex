import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  Eye,
  EyeOff,
  X,
  Save,
  Loader2,
  ShieldCheck,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "blocked";
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

// ─── Field Component ────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  helpText,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  helpText?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <Input
          type={isPassword && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="text-base bg-muted/30 border-border/50 pr-10"
        />
        {isPassword && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShow((s) => !s)}
          >
            {show ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}

// ─── Select Component ───────────────────────────────────────────────

function Select({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-base bg-muted/30 border border-border/50 rounded-md"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Create/Edit User Modal ─────────────────────────────────────────

function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user?: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState(user?.email || "");
  const [name, setName] = useState(user?.name || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">(user?.role || "member");
  const [status, setStatus] = useState<"active" | "blocked">(
    user?.status || "active"
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const endpoint = user
        ? `/api/access/users/${user.id}`
        : "/api/access/users";
      const method = user ? "PUT" : "POST";

      const body: any = { email, name, role, status };
      if (password) body.password = password;

      const res = await apiRequest(method, endpoint, body);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save user");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: user
          ? "User updated successfully"
          : "User created successfully",
      });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isLoading = mutation.isPending;
  const isPasswordRequired = !user;
  const isPasswordValid = !isPasswordRequired || password.length >= 8;

  const canSave =
    email.includes("@") &&
    name.trim() &&
    isPasswordValid &&
    !isLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-background border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            {user ? "Edit User" : "Create New User"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="user@example.com"
            required
            disabled={!!user}
          />

          <Field
            label="Full Name"
            value={name}
            onChange={setName}
            placeholder="John Doe"
            required
          />

          <Field
            label={user ? "New Password (optional)" : "Password"}
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="At least 8 characters"
            required={!user}
            helpText={
              !user
                ? "Must be at least 8 characters"
                : "Leave blank to keep current password"
            }
          />

          <Select
            label="Role"
            value={role}
            onChange={(v) => setRole(v as "admin" | "member")}
            options={[
              { value: "member", label: "Member" },
              { value: "admin", label: "Administrator" },
            ]}
            required
          />

          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as "active" | "blocked")}
            options={[
              { value: "active", label: "Active" },
              { value: "blocked", label: "Blocked" },
            ]}
            required
          />
        </div>

        <div className="flex gap-2 p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSave}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                {user ? "Update User" : "Create User"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Users Page ────────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | undefined>();
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch users list
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["/api/access/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/access/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: isAdmin,
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      // Note: The backend doesn't have a DELETE endpoint yet.
      // We'll use PUT to block the user instead
      const res = await apiRequest("PUT", `/api/access/users/${userId}`, {
        status: "blocked",
      });
      if (!res.ok) throw new Error("Failed to delete user");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/access/users"] });
      toast({
        title: "Success",
        description: "User has been blocked",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateUser = () => {
    setEditingUser(undefined);
    setShowModal(true);
  };

  const handleEditUser = (u: User) => {
    setEditingUser(u);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(undefined);
  };

  const handleUserSaved = () => {
    qc.invalidateQueries({ queryKey: ["/api/access/users"] });
    handleCloseModal();
  };

  const filteredUsers = users.filter((u: User) =>
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base text-muted-foreground">
              You need administrator privileges to access user management.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="w-8 h-8 text-primary" />
            Users
          </h1>
          <p className="text-base text-muted-foreground mt-1">
            Manage team members and their access levels
          </p>
        </div>
        <Button
          onClick={handleCreateUser}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Find Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      {/* Users List */}
      <div className="grid gap-3">
        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ) : filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-base text-muted-foreground text-center py-8">
                {users.length === 0
                  ? "No users yet. Create the first one!"
                  : "No users match your search."}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredUsers.map((u: User) => (
            <Card key={u.id} className="overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">{u.name}</h3>
                    <Badge
                      variant={u.role === "admin" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {u.role === "admin" ? (
                        <>
                          <ShieldCheck className="w-3 h-3 mr-1" />
                          Admin
                        </>
                      ) : (
                        "Member"
                      )}
                    </Badge>
                    <Badge
                      variant={u.status === "active" ? "outline" : "destructive"}
                      className="text-xs"
                    >
                      {u.status === "active" ? (
                        <>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Active
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Blocked
                        </>
                      )}
                    </Badge>
                  </div>

                  <p className="text-base text-muted-foreground mb-2">{u.email}</p>

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      Created:{" "}
                      {new Date(u.createdAt).toLocaleDateString()} at{" "}
                      {new Date(u.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {u.lastLoginAt && (
                      <p>
                        Last login:{" "}
                        {new Date(u.lastLoginAt).toLocaleDateString()} at{" "}
                        {new Date(u.lastLoginAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditUser(u)}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteUserMutation.mutate(u.id)}
                    disabled={
                      deleteUserMutation.isPending || u.id === currentUser?.id
                    }
                  >
                    {deleteUserMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <UserModal
          user={editingUser}
          onClose={handleCloseModal}
          onSaved={handleUserSaved}
        />
      )}
    </div>
  );
}
