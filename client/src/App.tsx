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
import MediaDetail from "@/pages/media-detail";
import SearchResults from "@/pages/search-results";
import CurrentEvents from "@/pages/current-events";
import UpcomingEvents from "@/pages/upcoming-events";
import ArchiveEvents from "@/pages/archive-events";
import CreatorApplication from "@/pages/creator/apply";
import CreatorEvents from "@/pages/creator-events";
import CreatorProfile from "@/pages/creator-profile";
import Imprint from "@/pages/imprint";
import CreditsPage from "@/pages/credits";
import { useEffect } from "react";
import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('React Error Boundary caught error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-destructive">Something went wrong</h1>
            <p className="text-muted-foreground">{this.state.error?.message}</p>
            <button 
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function Router() {
  useEffect(() => {
    console.log("Router component mounted");
  }, []);

  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/search" component={SearchResults} />
      <Route path="/current-events" component={CurrentEvents} />
      <Route path="/upcoming-events" component={UpcomingEvents} />
      <Route path="/archive-events" component={ArchiveEvents} />
      <Route path="/events/:id" component={EventGallery} />
      <Route path="/media/:id" component={MediaDetail} />
      <Route path="/creator-events" component={CreatorEvents} />
      <Route path="/imprint" component={Imprint} />
      <Route path="/credits" component={CreditsPage} />
      <ProtectedRoute path="/admin/dashboard" component={AdminDashboard} requireAdmin />
      <ProtectedRoute path="/admin/users" component={AdminUsers} requireAdmin />
      <ProtectedRoute path="/creator/dashboard" component={CreatorDashboard} requireCreator />
      <ProtectedRoute path="/creator/apply" component={CreatorApplication} />
      <Route path="/creator/:id" component={CreatorProfile} />
      <Route path="/" component={HomePage} />
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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;