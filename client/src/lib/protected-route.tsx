import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { authRedirectForCurrentPage } from "./auth-return";

type ProtectedRouteProps = {
  path: string;
  component: React.ComponentType;
  requireAdmin?: boolean;
  requireCreator?: boolean;
};

export function ProtectedRoute({
  path,
  component: Component,
  requireAdmin,
  requireCreator,
}: ProtectedRouteProps) {
  const { user, isLoading, error } = useAuth();

  console.log(`ProtectedRoute (${path}) - Auth State:`, { user, isLoading, requireAdmin, requireCreator });

  return (
    <Route path={path}>
      {() => {
        if (error) {
          return (
            <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
              <p>Your sign-in status could not be checked. Please try again.</p>
              <button className="underline" onClick={() => window.location.reload()}>Reload page</button>
            </div>
          );
        }
        if (isLoading) {
          return (
            <div className="flex items-center justify-center min-h-screen">
              <Loader2 className="h-8 w-8 animate-spin text-border" />
            </div>
          );
        }
        
        if (!user) {
          console.log(`Redirecting from ${path} to /auth - No user found`);
          return <Redirect to={authRedirectForCurrentPage()} />;
        }
        
        if (requireAdmin && !user.isAdmin) {
          console.log(`Redirecting from ${path} to / - Not an admin`);
          return <Redirect to="/" />;
        }
        
        const creatorAccessBlocked =
          Boolean((user as typeof user & { suspended?: boolean }).suspended) ||
          user.creatorStatus === "rejected";
        if (requireCreator && (creatorAccessBlocked || !(user.isCreator || user.isAdmin || user.creatorStatus === 'approved'))) {
          console.log(`Redirecting from ${path} to /creator/apply - Creator access unavailable`);
          return <Redirect to="/creator/apply" />;
        }
        
        console.log(`Rendering protected component at ${path}`);
        return <Component />;
      }}
    </Route>
  );
}
