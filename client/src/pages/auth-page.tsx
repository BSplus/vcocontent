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

// Create a simplified schema for login/register
const authSchema = z.object({
  username: z.string().min(1, "Benutzername ist erforderlich"),
  password: z.string().min(6, "Passwort muss mindestens 6 Zeichen lang sein"),
});

type AuthFormData = z.infer<typeof authSchema>;

export default function AuthPage() {
  const [_, setLocation] = useLocation();
  const { user, loginMutation, registerMutation } = useAuth();
  const { toast } = useToast();

  const loginForm = useForm<AuthFormData>({
    resolver: zodResolver(authSchema),
    defaultValues: { username: "", password: "" }
  });

  const registerForm = useForm<AuthFormData>({
    resolver: zodResolver(authSchema),
    defaultValues: { username: "", password: "" }
  });

  useEffect(() => {
    if (user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  const onLogin = async (data: AuthFormData) => {
    console.log("Login form submitted with data:", { username: data.username, password: data.password });
    try {
      console.log("Starting login mutation...");
      const result = await loginMutation.mutateAsync(data);
      console.log("Login mutation completed successfully", result);
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Anmeldung fehlgeschlagen",
        description: error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten",
        variant: "destructive",
      });
    }
  };

  const onRegister = async (data: AuthFormData) => {
    console.log("Register form submitted with data:", { username: data.username, password: data.password });
    try {
      console.log("Starting registration mutation...");
      await registerMutation.mutateAsync(data);
      console.log("Registration mutation completed successfully");
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Registrierung fehlgeschlagen",
        description: error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Become a VCO Creator</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="register">Register as Creator</TabsTrigger>
                <TabsTrigger value="login">Creator Login</TabsTrigger>
              </TabsList>

              <TabsContent value="register">
                <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-username">Benutzername</Label>
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
                    <Label htmlFor="register-password">Passwort</Label>
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
                        Registrierung...
                      </>
                    ) : (
                      'Als Creator registrieren'
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="login">
                <form onSubmit={(e) => {
                  e.preventDefault();
                  console.log("Form submit event triggered");
                  const formData = loginForm.getValues();
                  console.log("Form data:", { username: formData.username, password: formData.password });
                  loginForm.handleSubmit(onLogin)(e);
                }} 
                className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="login-username">Benutzername</Label>
                    <Input
                      id="login-username"
                      type="text"
                      {...loginForm.register("username")}
                      disabled={loginMutation.isPending}
                      onChange={(e) => {
                        loginForm.register("username").onChange(e);
                        console.log("Username changed:", e.target.value);
                      }}
                    />
                    {loginForm.formState.errors.username && (
                      <p className="text-sm font-medium text-destructive">
                        {loginForm.formState.errors.username.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Passwort</Label>
                    <Input
                      id="login-password"
                      type="password"
                      {...loginForm.register("password")}
                      disabled={loginMutation.isPending}
                      onChange={(e) => {
                        loginForm.register("password").onChange(e);
                        console.log("Password field changed:", e.target.value);
                      }}
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
                        Anmeldung...
                      </>
                    ) : (
                      'Als Creator anmelden'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <div className="hidden lg:flex items-center justify-center bg-muted p-8">
        <div className="max-w-md text-center">
          <h1 className="text-4xl font-bold mb-4">
            Share Your Racing Content
          </h1>
          <p className="text-lg text-muted-foreground">
            Join our community of creators and share your high-quality photos and videos from the most exciting Sim Racing events around the world.
          </p>
        </div>
      </div>
    </div>
  );
}