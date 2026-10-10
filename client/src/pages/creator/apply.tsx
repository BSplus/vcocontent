import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";
import LegalLinks from "@/components/legal-links";
import MediaRightsNotice from "@/components/media-rights-notice";

export default function CreatorApplicationPage() {
  const { user } = useAuth();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  useEffect(()=>{
    if (user?.emailVerifiedAt && !user.suspended && user.creatorStatus!=="rejected" &&
      (user.isCreator || user.isAdmin || user.creatorStatus==="approved")) setLocation("/creator/dashboard");
  },[user,setLocation]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/creator/request");
      return await res.json();
    },
    onSuccess: (activatedUser) => {
      // Update the role before entering a guarded route, not after a refetch.
      queryClient.setQueryData(["/api/user"],activatedUser);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Creator access activated",
        description: "Your account can now create photo galleries for the VCO community archive.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Application Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!user) {
    setLocation("/auth");
    return null;
  }
  const sendVerification = async () => {
    setVerificationBusy(true);
    setVerificationMessage("");
    try {
      await apiRequest("POST", "/api/email-verification/send");
      setVerificationMessage("Verification email sent. Check your inbox for the confirmation link.");
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "Could not send verification email.");
    } finally {
      setVerificationBusy(false);
    }
  };
  const betaUser = user as typeof user & { emailVerifiedAt?: string | null; creatorStatus?: string; suspended?: boolean };
  if (!betaUser.emailVerifiedAt) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-10">
        <Card className="mx-auto max-w-xl">
          <CardHeader><CardTitle>Verify your email first</CardTitle><CardDescription>Creator access is available after your email address is confirmed.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Confirm your email before activating creator access. We can send a new confirmation link to your account email.</p>
            <Button variant="outline" disabled={verificationBusy} onClick={() => void sendVerification()}>
              {verificationBusy ? "Sending…" : "Resend verification email"}
            </Button>
            {verificationMessage && <p role="status" className="text-sm">{verificationMessage}</p>}
             <LegalLinks />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
          <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Become a VCO Creator</CardTitle>
            <CardDescription>
              Contribute community racing photography to the VCO archive.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-5 text-sm">
              <p>Creator access lets you upload and manage your own community event galleries. New galleries remain private drafts until you publish them.</p>
              <div className="rounded-md border border-border bg-muted/40 p-4">
                <h3 className="mb-2 text-base">Public beta limits</h3>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>500 MB storage</li><li>5 galleries</li><li>1,000 photos total</li><li>5 MB per photo</li><li>Photos only; video uploads are unavailable</li>
                </ul>
              </div>
              <p className="text-muted-foreground">The beta is free; purchases, subscriptions and payouts are inactive. Future creator earnings are planned, with no dates or pricing announced.</p>
              <p>Only upload material you are entitled to share, respecting copyright and the rights of people shown or named. New public text and photos undergo separate automated safety checks; failed checks keep content private. The Privacy Policy explains the processing of media and private references.</p>
              <MediaRightsNotice />
              <LegalLinks />
              {(betaUser.creatorStatus === "rejected" || betaUser.suspended) && (
                <p role="alert" className="rounded border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                  {betaUser.suspended ? "Creator access is currently suspended. Contact VCO support for assistance." : "This creator request was declined. Please contact VCO support if you believe this is an error."}
                </p>
              )}
            </div>

            <Button 
              className="w-full"
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending || betaUser.creatorStatus === "rejected" || betaUser.suspended}
            >
              {applyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Activate creator access'
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
