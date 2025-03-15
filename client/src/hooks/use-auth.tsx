import { createContext, ReactNode, useContext, useEffect } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { insertUserSchema, User as SelectUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, InsertUser>;
};

type LoginData = Pick<InsertUser, "username" | "password">;

export const AuthContext = createContext<AuthContextType | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const {
    data: user,
    error,
    isLoading,
    refetch
  } = useQuery<SelectUser | undefined, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ 
      on401: "returnNull",
      onError: (error) => {
        console.error('Auth query error:', error);
        return null;
      }
    }),
    retry: false
  });

  // Debug logging
  useEffect(() => {
    console.log('Auth state changed:', {
      user,
      error,
      isLoading
    });
  }, [user, error, isLoading]);

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      try {
        console.log('Attempting login with credentials:', credentials.username);
        const res = await apiRequest("POST", "/api/login", credentials);
        const data = await res.json();
        console.log('Login response:', data);
        return data;
      } catch (error) {
        console.error('Login error:', error);
        throw error;
      }
    },
    onSuccess: (user: SelectUser) => {
      console.log('Login successful:', user);
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Willkommen zurück!",
        description: `Angemeldet als ${user.username}`,
      });
      refetch(); // Refetch user data after successful login
    },
    onError: (error: Error) => {
      console.error('Login mutation error:', error);
      toast({
        title: "Anmeldung fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: InsertUser) => {
      try {
        console.log('Attempting registration:', credentials.username);
        const res = await apiRequest("POST", "/api/register", credentials);
        const data = await res.json();
        console.log('Registration response:', data);
        return data;
      } catch (error) {
        console.error('Registration error:', error);
        throw error;
      }
    },
    onSuccess: (user: SelectUser) => {
      console.log('Registration successful:', user);
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Willkommen!",
        description: "Ihr Konto wurde erfolgreich erstellt.",
      });
      refetch(); // Refetch user data after successful registration
    },
    onError: (error: Error) => {
      console.error('Registration mutation error:', error);
      toast({
        title: "Registrierung fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      try {
        console.log('Attempting logout');
        await apiRequest("POST", "/api/logout");
        console.log('Logout successful');
      } catch (error) {
        console.error('Logout error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      console.log('Logout mutation successful');
      queryClient.setQueryData(["/api/user"], null);
      toast({
        title: "Abgemeldet",
        description: "Sie wurden erfolgreich abgemeldet.",
      });
      refetch(); // Refetch user data after successful logout
    },
    onError: (error: Error) => {
      console.error('Logout mutation error:', error);
      toast({
        title: "Abmeldung fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}