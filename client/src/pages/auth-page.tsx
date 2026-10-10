import { useAuth } from "@/hooks/use-auth";
import { returnAfterAuth } from "@/lib/auth-return";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import LegalLinks from "@/components/legal-links";

// Create schemas for login/register
const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

type LoginFormData = z.infer<typeof loginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const { toast } = useToast();
  const [verificationMessage, setVerificationMessage] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const verificationInProgress = useRef(false);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" }
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", email: "", password: "" }
  });

  // Verification tokens are intentionally POSTed, never consumed through a GET link.
  useEffect(() => {
    const match = window.location.hash.match(/(?:^#|&)verify=([^&]+)/);
    if (!match) return;
    verificationInProgress.current = true;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setVerificationBusy(true);
    let token: string;
    try {
      token = decodeURIComponent(match[1]);
    } catch {
      setVerificationMessage("The verification link is invalid. Request a new email confirmation link.");
      setVerificationBusy(false);
      return;
    }
    apiRequest("POST", "/api/email-verification/confirm", { token })
      .then(async response => {
        const result = await response.json().catch(() => ({}));
        setVerificationMessage(result.message || "Email verified. You can now request creator access.");
        void queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      })
      .catch(error => setVerificationMessage(error instanceof Error ? error.message : "Email verification failed."))
      .finally(() => setVerificationBusy(false));
  }, []);

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

  // Reload after authentication so the destination reads the established session.
  useEffect(() => {
    let redirectTimeout: NodeJS.Timeout;
    
    if (user && !verificationInProgress.current) {
      const destination = returnAfterAuth(new URLSearchParams(window.location.search).get("next"), user);
      redirectTimeout = setTimeout(() => {
        window.location.replace(destination);
      }, 100);
    }
    
    return () => {
      if (redirectTimeout) {
        clearTimeout(redirectTimeout);
      }
    };
  }, [user]);

  const onLoginSubmit = async (formData: LoginFormData) => {
    console.log('Login form submitted:', { username: formData.username });
    try {
      console.log('Starting login mutation...');
      await loginMutation.mutateAsync(formData);
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: "Login Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const onRegisterSubmit = async (formData: RegisterFormData) => {
    try {
      await registerMutation.mutateAsync(formData);
      setVerificationEmail(formData.email);
      setVerificationMessage("Account created. Verify your email before requesting creator access.");
    } catch (error) {
      console.error('Registration error:', error);
      toast({
        title: "Registration Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[0.88fr_1.12fr]">
      <div className="flex items-center justify-center p-5 sm:p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>VCO Media Platform</CardTitle>
            <CardDescription>
          Discover VCO racing media or publish your community photos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form 
                  onSubmit={loginForm.handleSubmit(onLoginSubmit)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="login-username">Username</Label>
                    <Input
                      id="login-username"
                      type="text"
                      {...loginForm.register("username")}
                      disabled={loginMutation.isPending}
                    />
                    {loginForm.formState.errors.username && (
                      <p className="text-sm font-medium text-destructive">
                        {loginForm.formState.errors.username.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      {...loginForm.register("password")}
                      disabled={loginMutation.isPending}
                    />
                    {loginForm.formState.errors.password && (
                      <p className="text-sm font-medium text-destructive">
                        {loginForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={loginMutation.isPending || loginForm.formState.isSubmitting}
                  >
                    {loginMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Logging in...
                      </>
                    ) : (
                      'Login'
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form 
                  onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="register-username">Username</Label>
                    <Input
                      id="register-username"
                      type="text"
                      {...registerForm.register("username")}
                      disabled={registerMutation.isPending}
                    />
                    {registerForm.formState.errors.username && (
                      <p className="text-sm font-medium text-destructive">
                        {registerForm.formState.errors.username.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
                      type="email"
                      {...registerForm.register("email")}
                      disabled={registerMutation.isPending}
                    />
                    {registerForm.formState.errors.email && (
                      <p className="text-sm font-medium text-destructive">
                        {registerForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Password</Label>
                    <Input
                      id="register-password"
                      type="password"
                      {...registerForm.register("password")}
                      disabled={registerMutation.isPending}
                    />
                    {registerForm.formState.errors.password && (
                      <p className="text-sm font-medium text-destructive">
                        {registerForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={registerMutation.isPending || registerForm.formState.isSubmitting}
                  >
                    {registerMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Registering...
                      </>
                    ) : (
                      'Create account'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
            {(verificationBusy || verificationMessage || (user && !user.emailVerifiedAt)) && (
              <div className="mt-5 space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4" role="status">
                <p className="text-sm">{verificationMessage || (verificationBusy ? "Confirming your email…" : "Verify your email to continue to creator access.")}</p>
                {user && !user.emailVerifiedAt && (
                  <Button type="button" variant="outline" disabled={verificationBusy} onClick={() => void sendVerification()}>
                    {verificationBusy ? "Working…" : "Send verification email"}
                  </Button>
                )}
                {verificationEmail && <p className="text-xs text-muted-foreground">Sent to {verificationEmail}</p>}
              </div>
            )}
            <div className="mt-6 border-t border-border pt-4">
              <p className="text-sm leading-relaxed">Our Privacy Policy explains account data, email verification and automated safety checks of public profile text. It is information, not a consent requirement.</p>
              <LegalLinks />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative hidden items-center justify-center overflow-hidden border-l border-border bg-secondary p-8 lg:flex">
        <img src="/attached_assets/IMG_7464.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
        <div className="absolute inset-0 bg-gradient-to-r from-secondary via-secondary/75 to-secondary/35" />
        <div className="relative max-w-lg">
          <img src="/attached_assets/VCO_2021_reg_White_Trans.png" alt="VCO" className="mb-10 h-12 w-auto" />
          <p className="vco-kicker mb-4">Inside the archive</p>
          <h1 className="mb-4 text-6xl font-extrabold leading-[0.86]">
            VCO Sim Racing Media Platform
          </h1>
          <p className="text-lg text-muted-foreground mb-6">
            Access high-quality photos and videos from the most exciting Sim Racing events around the world.
          </p>
          
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 15h14a2 2 0 1 1 0 4H3"/><path d="M21 12H5a2 2 0 0 0 0 4h16"/></svg>
              </div>
              <div>
                <h3 className="font-medium">Public Beta Access</h3>
                <p className="text-sm text-muted-foreground">Browse and download racing media during the public beta</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div>
                <h3 className="font-medium">Creator Opportunities</h3>
                <p className="text-sm text-muted-foreground">Share your content with the sim racing community</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
              </div>
              <div>
                <h3 className="font-medium">Official VCO Events</h3>
                <p className="text-sm text-muted-foreground">Content from the most prestigious sim racing competitions</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}