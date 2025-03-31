import React, { useState, useEffect } from 'react';
import { useStripe, useElements, PaymentElement, Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CreditCard, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';

// Lade Stripe außerhalb der Komponente, um keine unnötigen Reintialisierungen zu haben
if (!import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
  throw new Error('VITE_STRIPE_PUBLIC_KEY umgebungsvariable fehlt');
}

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

// Komponente für das Zahlungsformular
function CheckoutForm({ amount, onSuccess }: { amount: number; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setMessage('');

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin,
        },
        redirect: 'if_required',
      });

      if (error) {
        setMessage(error.message || 'Ein Fehler ist aufgetreten.');
        toast({
          title: 'Zahlungsfehler',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        // Die Zahlung war erfolgreich
        toast({
          title: 'Zahlung erfolgreich',
          description: `${amount} Credits wurden deinem Konto gutgeschrieben.`,
        });
        onSuccess();
      }
    } catch (error) {
      console.error('Payment error:', error);
      setMessage('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      
      {message && (
        <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {message}
        </div>
      )}
      
      <Button 
        disabled={isProcessing || !stripe || !elements} 
        type="submit" 
        className="w-full bg-primary"
      >
        {isProcessing ? (
          <span className="flex items-center">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verarbeitung...
          </span>
        ) : (
          <span className="flex items-center">
            <CreditCard className="mr-2 h-4 w-4" />
            Jetzt {amount} Credits für {amount}€ kaufen
          </span>
        )}
      </Button>
    </form>
  );
}

// Hauptkomponente für den Credit-Kauf
export function PurchaseCredits() {
  const [amount, setAmount] = useState(10);
  const [clientSecret, setClientSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  // Stripe Options
  const appearance = {
    theme: 'night' as const,
    variables: {
      colorPrimary: '#3b82f6',
      colorBackground: '#1f2937',
      colorText: '#ffffff',
      colorDanger: '#ef4444',
      fontFamily: 'Rajdhani, sans-serif',
      borderRadius: '4px',
    },
  };

  const getClientSecret = async () => {
    if (!user) {
      toast({
        title: 'Anmeldung erforderlich',
        description: 'Bitte melde dich an, um Credits zu kaufen.',
        variant: 'destructive',
      });
      return;
    }

    if (amount < 1) {
      toast({
        title: 'Ungültiger Betrag',
        description: 'Bitte gib einen positiven Betrag ein.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest('POST', '/api/credits/purchase', { amount });
      const data = await response.json();
      
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
      } else {
        throw new Error('Keine Client-Secret-Antwort vom Server');
      }
    } catch (error) {
      console.error('Error getting client secret:', error);
      toast({
        title: 'Fehler',
        description: 'Die Zahlungsinitialisierung ist fehlgeschlagen. Bitte versuche es erneut.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccess = () => {
    setSuccess(true);
    setClientSecret('');
    // Wir könnten hier die Seite neuladen, um den aktualisierten Credit-Stand zu sehen
    // Alternativ könnten wir auch den Auth-Context aktualisieren
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  };

  const resetForm = () => {
    setSuccess(false);
    setClientSecret('');
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Credits kaufen</CardTitle>
        <CardDescription>Kaufe Credits, um Premium-Inhalte herunterzuladen</CardDescription>
      </CardHeader>
      <CardContent>
        {!clientSecret && !success && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Anzahl der Credits</Label>
              <Input
                id="amount"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                className="bg-card"
              />
              <p className="text-sm text-muted-foreground mt-1">
                1 Credit = 1€. Credits werden für Premium-Downloads verwendet.
              </p>
            </div>
            <Button 
              onClick={getClientSecret} 
              disabled={isLoading || !user}
              className="w-full"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Laden...
                </span>
              ) : 'Weiter zur Zahlung'}
            </Button>
            {!user && (
              <p className="text-sm text-destructive mt-2">
                Du musst angemeldet sein, um Credits zu kaufen.
              </p>
            )}
          </div>
        )}

        {clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <CheckoutForm amount={amount} onSuccess={handleSuccess} />
          </Elements>
        )}

        {success && (
          <div className="text-center py-8 space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-green-600">Zahlung erfolgreich!</h3>
            <p>{amount} Credits wurden deinem Konto gutgeschrieben.</p>
            <Button onClick={resetForm} variant="outline" className="mt-4">
              Weitere Credits kaufen
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <p>Alle Zahlungen werden sicher über Stripe abgewickelt.</p>
      </CardFooter>
    </Card>
  );
}