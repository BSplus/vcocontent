import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
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
import { useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";

// Create schemas for login/register
const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  requestCreator: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const [_, setLocation] = useLocation();
  const { user, loginMutation, registerMutation } = useAuth();
  const { toast } = useToast();

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" }
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { 
      username: "", 
      email: "", 
      password: "", 
      requestCreator: false 
    }
  });

  // Improved redirect logic with full page reload to ensure cookies are set
  useEffect(() => {
    let redirectTimeout: NodeJS.Timeout;
    
    if (user) {
      console.log('User detected in auth page, redirecting to home', user);
      // Use a full page reload to ensure session cookies are properly set
      redirectTimeout = setTimeout(() => {
        console.log('Executing full page reload to home');
        window.location.href = "/";
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
    console.log('Register form submitted:', { 
      username: formData.username, 
      requestCreator: formData.requestCreator 
    });
    try {
      console.log('Starting registration mutation...');
      await registerMutation.mutateAsync(formData);
      if (formData.requestCreator) {
        toast({
          title: "Creator Account Pending",
          description: "Your creator account request has been submitted and is pending approval.",
        });
      }
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
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>VCO Media Platform</CardTitle>
            <CardDescription>
              Discover sim racing media or apply to become a creator
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
                  <div className="flex items-center space-x-2 mt-4">
                    <Checkbox 
                      id="request-creator" 
                      {...registerForm.register("requestCreator")}
                      disabled={registerMutation.isPending}
                    />
                    <Label htmlFor="request-creator" className="font-normal">
                      Register as Content Creator
                    </Label>
                  </div>
                  {registerForm.watch("requestCreator") && (
                    <div className="p-3 rounded-md bg-muted text-sm">
                      <p>Creator benefits:</p>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>Upload photos and videos from racing events</li>
                        <li>Share your work with the sim racing community</li>
                        <li>Get recognized in the sim racing community</li>
                      </ul>
                      <p className="mt-2 text-muted-foreground text-xs">Your creator application will be reviewed by VCO admins.</p>
                    </div>
                  )}
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
                      registerForm.watch("requestCreator") 
                        ? 'Register as Creator' 
                        : 'Register as User'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <div className="hidden lg:flex items-center justify-center bg-muted p-8">
        <div className="max-w-md">
          <h1 className="text-4xl font-bold mb-4">
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