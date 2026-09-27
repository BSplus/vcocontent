import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CreditsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center mb-8">
          <Button asChild variant="outline" className="mr-4">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">Public Beta</h1>
        </div>
        <div className="max-w-2xl rounded-lg border border-primary/20 bg-card p-6">
          <h2 className="text-xl font-semibold">Credit purchases and paid premium features are unavailable.</h2>
          <p className="mt-2 text-muted-foreground">
            During the public beta, media downloads are available without purchasing credits.
          </p>
        </div>
      </div>
    </div>
  );
}