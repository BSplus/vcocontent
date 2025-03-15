import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";

type ProtectedRouteProps = {
  path: string;
  component: () => React.JSX.Element;
  requireAdmin?: boolean;
  requireCreator?: boolean;
};

export function ProtectedRoute({
  path,
  component: Component,
  requireAdmin,
  requireCreator,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  return (
    <Route path={path}>
      {isLoading ? (
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      ) : !user ? (
        <Redirect to="/auth" />
      ) : requireAdmin && !user.isAdmin ? (
        <Redirect to="/" />
      ) : requireCreator && !user.isCreator ? (
        <Redirect to="/creator/apply" />
      ) : (
        <Component />
      )}
    </Route>
  );
}