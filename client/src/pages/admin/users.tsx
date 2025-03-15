import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User } from "@shared/schema";
import { Loader2, Shield, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AdminUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load all users
  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    staleTime: 0,
  });

  // Update user role mutation
  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, action }: { userId: number; action: string }) => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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

  if (usersLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
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
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {user.isAdmin && (
                          <Badge variant="default" className="bg-red-500">
                            Admin
                          </Badge>
                        )}
                        {user.isCreator && (
                          <Badge variant="default" className="bg-green-500">
                            Creator
                          </Badge>
                        )}
                        {!user.isAdmin && !user.isCreator && (
                          <Badge variant="secondary">
                            User
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{user.credits || 0}</TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {/* Allow making any user an admin (except current admins) */}
                        {!user.isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex gap-2 items-center"
                            onClick={() => updateUserRoleMutation.mutate({
                              userId: user.id,
                              action: 'set_admin'
                            })}
                            disabled={updateUserRoleMutation.isPending}
                          >
                            <Shield className="h-4 w-4" />
                            Make Admin
                          </Button>
                        )}
                        {/* Allow making any user a creator (except those already creators or pending) */}
                        {!user.isCreator && user.creatorStatus !== 'pending' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex gap-2 items-center"
                            onClick={() => updateUserRoleMutation.mutate({
                              userId: user.id,
                              action: 'approve_creator'
                            })}
                            disabled={updateUserRoleMutation.isPending}
                          >
                            <UserCheck className="h-4 w-4" />
                            Make Creator
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
