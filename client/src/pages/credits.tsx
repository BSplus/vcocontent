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
              Zurück zur Startseite
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">Credits verwalten</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <PurchaseCredits />
          </div>
          
          <div>
            <div className="bg-card rounded-lg shadow-md p-6 space-y-4">
              <h2 className="text-xl font-bold">Deine Credits</h2>
              {user ? (
                <>
                  <div className="text-4xl font-bold text-primary">
                    {user.credits || 0} <span className="text-base text-muted-foreground">Credits</span>
                  </div>
                  
                  <div className="space-y-2 mt-6">
                    <h3 className="text-lg font-semibold">Was kannst du mit Credits machen?</h3>
                    <ul className="space-y-2 ml-5 list-disc text-muted-foreground">
                      <li>Premium-Fotos und -Videos herunterladen</li>
                      <li>Hochwertige Inhalte von professionellen Creators erhalten</li>
                      <li>Zugang zu exklusiven Event-Aufnahmen bekommen</li>
                    </ul>
                  </div>
                </>
              ) : (
                <div className="p-4 bg-primary/10 rounded-md">
                  <p className="text-center">
                    Bitte <Link href="/auth"><a className="text-primary font-bold">melde dich an</a></Link>, um 
                    deine Credits zu sehen und zu verwalten.
                  </p>
                </div>
              )}
            </div>
            
            <div className="bg-card rounded-lg shadow-md p-6 mt-6">
              <h3 className="text-lg font-semibold mb-3">Häufig gestellte Fragen</h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">Wie kaufe ich Credits?</h4>
                  <p className="text-sm text-muted-foreground">
                    Wähle die gewünschte Menge an Credits und bezahle sicher über 
                    Stripe mit deiner Kredit- oder Debitkarte.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium">Wie lange sind meine Credits gültig?</h4>
                  <p className="text-sm text-muted-foreground">
                    Deine Credits verfallen nicht und bleiben auf deinem Konto, 
                    bis du sie verwendest.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium">Kann ich Credits zurückgeben?</h4>
                  <p className="text-sm text-muted-foreground">
                    Einmal gekaufte Credits können nicht zurückerstattet werden, 
                    aber sie verfallen auch nicht.
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