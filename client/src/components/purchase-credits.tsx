import { useState } from 'react';
import { useStripe, useElements, PaymentElement, Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

if (!import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
  throw new Error('Missing required Stripe key: VITE_STRIPE_PUBLIC_KEY');
}

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

function CheckoutForm({ amount, onSuccess }: { amount: number; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      toast({
        title: "Error",
        description: "Stripe is not initialized",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/profile`,
        },
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Payment Successful",
          description: `${amount} credits have been added to your account.`,
        });
        onSuccess();
      }
    } catch (error) {
      console.error('Payment error:', error);
      toast({
        title: "Payment Error",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <Button 
        type="submit" 
        disabled={isProcessing || !stripe || !elements} 
        className="w-full"
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : null}
        Pay €{amount}
      </Button>
    </form>
  );
}

export function PurchaseCredits() {
  const [amount, setAmount] = useState(10);
  const [clientSecret, setClientSecret] = useState("");
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handlePurchase = async () => {
    setIsLoading(true);
    try {
      if (amount < 1) {
        throw new Error("Amount must be at least 1 credit");
      }

      const response = await fetch('/api/credits/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: Math.floor(amount) }), // Ensure integer amount
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.clientSecret) {
        throw new Error("No client secret received from server");
      }

      setClientSecret(data.clientSecret);
    } catch (error) {
      console.error('Purchase error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to initiate purchase",
        variant: "destructive",
      });
      setIsDialogOpen(false); // Close dialog on error
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Purchase Credits</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Purchase Credits</DialogTitle>
        </DialogHeader>
        {!clientSecret ? (
          <Card>
            <CardHeader>
              <CardTitle>Select Amount</CardTitle>
              <CardDescription>
                1 Credit = €1. Credits can be used to download premium content.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount of Credits</Label>
                <Input
                  id="amount"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                />
              </div>
              <Button 
                onClick={handlePurchase} 
                className="w-full"
                disabled={isLoading || amount < 1}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Continue to Payment
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4">
            {stripePromise && clientSecret && (
              <Elements 
                stripe={stripePromise} 
                options={{ clientSecret }}
              >
                <CheckoutForm 
                  amount={amount} 
                  onSuccess={() => {
                    setClientSecret("");
                    setIsDialogOpen(false);
                  }} 
                />
              </Elements>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}