import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User } from "@shared/schema";
import { Loader2, Shield, Ban, RotateCcw, Database, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import MainNavigation from "@/components/main-navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BetaUser = User & {
  emailVerifiedAt?: string | null;
  suspended?: boolean;
  quotaException?: boolean;
};

export default function AdminUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reconcileResults, setReconcileResults] = useState<Record<number, string>>({});

  // Load all users
  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery<BetaUser[]>({
    queryKey: ["/api/admin/users"],
    staleTime: 0,
  });

  // Update user role mutation
  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, action, enabled }: { userId: number; action: string; enabled?: boolean }) => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(enabled === undefined ? {} : { enabled }) }),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update user role");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  const reconcileStorageMutation = useMutation({
    mutationFn: async (userId: number) =>
      (await apiRequest("POST", `/api/admin/creator-storage/${userId}/reconcile`)).json() as Promise<Record<string, unknown>>,
    onSuccess: (result: Record<string, unknown>, userId: number) => {
      const updated = result.updated ?? result.updatedCount;
      const unresolved = result.unresolved ?? result.unresolvedCount;
      const summary = updated !== undefined || unresolved !== undefined
        ? `Updated ${String(updated ?? "—")}; unresolved ${String(unresolved ?? "—")}.`
        : typeof result.message === "string" ? result.message : JSON.stringify(result);
      setReconcileResults(previous => ({ ...previous, [userId]: summary }));
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/media-usage"] });
      toast({ title: "Storage reconciliation finished", description: summary });
    },
    onError: (error: Error) => toast({ title: "Storage reconciliation failed", description: error.message, variant: "destructive" }),
  });

  const roles = (user: BetaUser) => (
    <div className="flex flex-wrap gap-2">
      {user.isAdmin && <Badge variant="default" className="bg-red-500">Admin</Badge>}
      {user.isCreator && <Badge variant="default" className="bg-green-500">Creator</Badge>}
      {!user.isAdmin && !user.isCreator && <Badge variant="secondary">User</Badge>}
    </div>
  );
  const actions = (user: BetaUser) => (
    <div className="flex flex-wrap gap-2">
      {!user.isAdmin && (
        <Button variant="outline" size="sm" className="min-h-10 gap-2"
          onClick={() => updateUserRoleMutation.mutate({ userId: user.id, action: "set_admin" })}
          disabled={updateUserRoleMutation.isPending}>
          <Shield className="h-4 w-4" /> Make Admin
        </Button>
      )}
      {user.isCreator && (
        <Button variant="outline" size="sm" className="min-h-10 gap-2"
          onClick={() => updateUserRoleMutation.mutate({ userId: user.id, action: user.suspended ? "restore_creator" : "suspend_creator" })}
          disabled={updateUserRoleMutation.isPending}>
          {user.suspended ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          {user.suspended ? "Restore creator" : "Suspend creator"}
        </Button>
      )}
      {user.isCreator && (
        <Button variant="outline" size="sm" className="min-h-10 gap-2"
          onClick={() => updateUserRoleMutation.mutate({ userId: user.id, action: "quota_exception", enabled: !user.quotaException })}
          disabled={updateUserRoleMutation.isPending}>
          <Database className="h-4 w-4" />{user.quotaException ? "Remove 2× exception" : "Enable 2× exception"}
        </Button>
      )}
      {user.isCreator && (
        <div className="basis-full space-y-1">
          <Button variant="outline" size="sm" className="min-h-10 gap-2"
            onClick={() => reconcileStorageMutation.mutate(user.id)}
            disabled={reconcileStorageMutation.isPending}>
            {reconcileStorageMutation.isPending && reconcileStorageMutation.variables === user.id
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
            Reconcile legacy storage
          </Button>
          <p className="text-xs text-muted-foreground">Measures existing object sizes only; does not analyze or delete media.</p>
          {reconcileResults[user.id] && <p role="status" className="text-xs text-primary">{reconcileResults[user.id]}</p>}
        </div>
      )}
    </div>
  );

  if (usersLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (usersError) {
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>Die Nutzerverwaltung konnte nicht geladen werden.</p>
      <Button onClick={() => window.location.reload()}>Seite neu laden</Button>
    </div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <MainNavigation />
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            USER MANAGEMENT
          </h1>
          <div className="flex gap-2 mt-4">
            <Button asChild variant="outline">
              <Link href="/admin/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>All Users</CardTitle>
            <CardDescription>
              Manage user roles and permissions
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <div className="space-y-3 md:hidden">
              {users.map((user) => (
                <section key={user.id} aria-label={`User ${user.username}`} className="min-w-0 space-y-3 rounded-lg border p-4">
                  <h2 className="break-all font-semibold">{user.username}</h2>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Role</dt><dd>{roles(user)}</dd>
                      <dt className="text-muted-foreground">Email</dt><dd>{user.emailVerifiedAt ? "Verified" : "Unverified"}</dd>
                      <dt className="text-muted-foreground">Creator access</dt><dd>{user.isCreator ? (user.suspended ? "Suspended" : "Active") : user.creatorStatus || "Standard"}</dd>
                      <dt className="text-muted-foreground">Quota exception</dt><dd>{user.quotaException ? "Enabled · bounded 2×" : "No"}</dd>
                      <dt className="text-muted-foreground">Credits</dt><dd>{user.credits || 0}</dd>
                    <dt className="text-muted-foreground">Created</dt><dd>{formatDate(user.createdAt)}</dd>
                  </dl>
                  <div aria-label={`Actions for ${user.username}`}>{actions(user)}</div>
                </section>
              ))}
            </div>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Creator access</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="max-w-48 break-all">{user.username}</TableCell>
                    <TableCell>{roles(user)}</TableCell>
                    <TableCell>{user.emailVerifiedAt ? "Verified" : "Unverified"}</TableCell>
                    <TableCell>{user.isCreator ? (user.suspended ? "Suspended" : "Active") : user.creatorStatus || "Standard"}</TableCell>
                    <TableCell>{user.quotaException ? "Bounded 2×" : "Standard"}</TableCell>
                    <TableCell>{user.credits || 0}</TableCell>
                    <TableCell>
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell>{actions(user)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
