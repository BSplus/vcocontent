import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";

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
        if (isLoading) {
          return (
            <div className="flex items-center justify-center min-h-screen">
              <Loader2 className="h-8 w-8 animate-spin text-border" />
            </div>
          );
        }
        if (error) {
          return (
            <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
              <p>Die Anmeldung konnte nicht geprüft werden. Bitte versuche es erneut.</p>
              <button className="underline" onClick={() => window.location.reload()}>Seite neu laden</button>
            </div>
          );
        }
        
        if (!user) {
          console.log(`Redirecting from ${path} to /auth - No user found`);
          return <Redirect to="/auth" />;
        }
        
        if (requireAdmin && !user.isAdmin) {
          console.log(`Redirecting from ${path} to / - Not an admin`);
          return <Redirect to="/" />;
        }
        
        if (requireCreator && !(user.isCreator || user.creatorStatus === 'approved')) {
          console.log(`Redirecting from ${path} to /creator/apply - Not a creator`);
          return <Redirect to="/creator/apply" />;
        }
        
        console.log(`Rendering protected component at ${path}`);
        return <Component />;
      }}
    </Route>
  );
}