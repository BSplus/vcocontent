import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Settings, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PurchaseCredits } from "@/components/purchase-credits";

export default function MainNavigation() {
  const { user, logoutMutation } = useAuth();

  return (
    <header className="border-b border-primary/20 bg-black/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-2 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <img 
              src="/attached_assets/VCO_2021_reg_White_Trans.png"
              alt="VCO Logo"
              className="h-[100px] w-auto" 
            />
            <span className="text-2xl font-[Orbitron] text-white tracking-wider">
              MEDIA DATABASE
            </span>
          </Link>
          <nav className="hidden md:flex gap-4 items-center">
            <Link href="/" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
              Home
            </Link>
            <Link href="/current-events" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
              Current Events
            </Link>
            <Link href="/upcoming-events" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
              Upcoming Events
            </Link>
            <Link href="/archive-events" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
              Archive
            </Link>
            <Link href="/search" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search Media
            </Link>

            {/* Additional navigation items for creators */}
            {user?.isCreator && (
              <Link href="/creator/dashboard" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Creator Dashboard
              </Link>
            )}

            {/* Admin-specific navigation items */}
            {user?.isAdmin && (
              <>
                <Link href="/admin/dashboard" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Admin Dashboard
                </Link>
                <Link href="/admin/users" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  User Management
                </Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex gap-4 items-center">
          {/* Show different buttons based on user state */}
          {!user && (
            <Button asChild className="bg-primary text-black hover:bg-primary/90">
              <Link href="/auth">Login / Register</Link>
            </Button>
          )}

          {/* Show creator application button for normal users */}
          {user && !user.isCreator && !user.isAdmin && user.creatorStatus !== 'pending' && (
            <Button asChild className="bg-primary text-black hover:bg-primary/90">
              <Link href="/creator/apply">BECOME A CREATOR</Link>
            </Button>
          )}

          {/* Show credits and purchase button for logged-in users */}
          {user && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-foreground/80">
                Credits: {user.credits || 0}
              </span>
              <PurchaseCredits />
            </div>
          )}

          {/* Show logout button when logged in */}
          {user && (
            <Button
              variant="secondary"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {logoutMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Logout'
              )}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}