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

// Load Stripe outside of components to avoid unnecessary re-initializations
const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;

// Avoid hard failure if Stripe key is not available
const stripePromise = stripePublicKey 
  ? loadStripe(stripePublicKey)
  : Promise.reject(new Error('Missing Stripe public key'));

// Component for the payment form
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
        setMessage(error.message || 'An error occurred.');
        toast({
          title: 'Payment Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        // Payment was successful
        toast({
          title: 'Payment Successful',
          description: `${amount} credits have been added to your account.`,
        });
        onSuccess();
      }
    } catch (error) {
      console.error('Payment error:', error);
      setMessage('An unexpected error occurred.');
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
            Processing...
          </span>
        ) : (
          <span className="flex items-center">
            <CreditCard className="mr-2 h-4 w-4" />
            Buy {amount} Credits for €{amount} now
          </span>
        )}
      </Button>
    </form>
  );
}

// Main component for credit purchase
export function PurchaseCredits() {
  const [amount, setAmount] = useState(10);
  const [clientSecret, setClientSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);
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
        title: 'Login Required',
        description: 'Please sign in to purchase credits.',
        variant: 'destructive',
      });
      return;
    }

    if (amount < 1) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a positive amount.',
        variant: 'destructive',
      });
      return;
    }

    if (!stripePublicKey) {
      setStripeError('Stripe is not configured. Please contact the administrator.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest('POST', '/api/credits/purchase', { amount });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || 'Payment initialization failed');
      }
      
      const data = await response.json();
      
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
      } else {
        throw new Error('No client secret received from server');
      }
    } catch (error) {
      console.error('Error getting client secret:', error);
      toast({
        title: 'Payment Error',
        description: error instanceof Error ? error.message : 'Payment initialization failed. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccess = () => {
    setSuccess(true);
    setClientSecret('');
    // We could reload the page here to see the updated credit balance
    // Alternatively, we could update the Auth context
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  };

  const resetForm = () => {
    setSuccess(false);
    setClientSecret('');
  };

  // Check if Stripe is available before rendering
  useEffect(() => {
    if (!stripePublicKey) {
      setStripeError('Stripe is not configured. Please contact the administrator.');
    } else {
      setStripeError(null);
    }
  }, []);

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Purchase Credits</CardTitle>
        <CardDescription>Buy credits to download premium content</CardDescription>
      </CardHeader>
      <CardContent>
        {stripeError && (
          <div className="p-4 bg-red-50 text-red-700 rounded-md mb-4">
            {stripeError}
          </div>
        )}
        
        {!clientSecret && !success && !stripeError && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Number of Credits</Label>
              <Input
                id="amount"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                className="bg-card"
              />
              <p className="text-sm text-muted-foreground mt-1">
                1 Credit = €1. Credits are used for premium downloads.
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
                  Loading...
                </span>
              ) : 'Proceed to Payment'}
            </Button>
            {!user && (
              <p className="text-sm text-destructive mt-2">
                You must be logged in to purchase credits.
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
            <h3 className="text-xl font-bold text-green-600">Payment Successful!</h3>
            <p>{amount} credits have been added to your account.</p>
            <Button onClick={resetForm} variant="outline" className="mt-4">
              Purchase More Credits
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <p>All payments are securely processed through Stripe.</p>
      </CardFooter>
    </Card>
  );
}