import React from 'react';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PurchaseCredits } from '@/components/purchase-credits';
import { useAuth } from '@/hooks/use-auth';

export default function CreditsPage() {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }
  
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
          <h1 className="text-3xl font-bold">Manage Credits</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <PurchaseCredits />
          </div>
          
          <div>
            <div className="bg-card rounded-lg shadow-md p-6 space-y-4">
              <h2 className="text-xl font-bold">Your Credits</h2>
              {user ? (
                <>
                  <div className="text-4xl font-bold text-primary">
                    {user.credits || 0} <span className="text-base text-muted-foreground">Credits</span>
                  </div>
                  
                  <div className="space-y-2 mt-6">
                    <h3 className="text-lg font-semibold">What can you do with credits?</h3>
                    <ul className="space-y-2 ml-5 list-disc text-muted-foreground">
                      <li>Download premium photos and videos</li>
                      <li>Access high-quality content from professional creators</li>
                      <li>Get exclusive event footage</li>
                    </ul>
                  </div>
                </>
              ) : (
                <div className="p-4 bg-primary/10 rounded-md">
                  <p className="text-center">
                    Please <Link href="/auth"><a className="text-primary font-bold">sign in</a></Link> to 
                    view and manage your credits.
                  </p>
                </div>
              )}
            </div>
            
            <div className="bg-card rounded-lg shadow-md p-6 mt-6">
              <h3 className="text-lg font-semibold mb-3">Frequently Asked Questions</h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">How do I purchase credits?</h4>
                  <p className="text-sm text-muted-foreground">
                    Select your desired amount of credits and pay securely via 
                    Stripe with your credit or debit card.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium">How long are my credits valid?</h4>
                  <p className="text-sm text-muted-foreground">
                    Your credits do not expire and will remain in your account 
                    until you use them.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium">Can I get a refund for credits?</h4>
                  <p className="text-sm text-muted-foreground">
                    Once purchased, credits cannot be refunded, 
                    but they also don't expire.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}