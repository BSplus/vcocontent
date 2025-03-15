import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "./lib/protected-route";
import HomePage from "@/pages/home-page";
import AuthPage from "@/pages/auth-page";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import CreatorDashboard from "@/pages/creator/dashboard";
import EventGallery from "@/pages/event-gallery";
import SearchResults from "@/pages/search-results";
import CurrentEvents from "@/pages/current-events";
import UpcomingEvents from "@/pages/upcoming-events";
import ArchiveEvents from "@/pages/archive-events";
import CreatorApplication from "@/pages/creator/apply";
import Imprint from "@/pages/imprint";
import { useEffect } from "react";

function Router() {
  useEffect(() => {
    console.log("Router component mounted");
  }, []);

  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/search" component={SearchResults} />
      <Route path="/current-events" component={CurrentEvents} />
      <Route path="/upcoming-events" component={UpcomingEvents} />
      <Route path="/archive-events" component={ArchiveEvents} />
      <Route path="/events/:id" component={EventGallery} />
      <Route path="/imprint" component={Imprint} />
      <ProtectedRoute path="/admin/dashboard" component={AdminDashboard} requireAdmin />
      <ProtectedRoute path="/admin/users" component={AdminUsers} requireAdmin />
      <ProtectedRoute path="/creator/dashboard" component={CreatorDashboard} requireCreator />
      <ProtectedRoute path="/creator/apply" component={CreatorApplication} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  console.log("App component initializing");

  useEffect(() => {
    console.log("App component mounted");
    // Log any global errors
    window.onerror = (message, source, lineno, colno, error) => {
      console.error("Global error:", { message, source, lineno, colno, error });
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;