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
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function CreatorApplicationPage() {
  const { user } = useAuth();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/creator/request");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Application Submitted",
        description: "Your creator application has been submitted for review.",
      });
      setLocation("/");
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
              Join our community of creators and share your sim racing content with the world.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="prose prose-invert">
              <h3>Creator Benefits</h3>
              <ul>
                <li>Share your sim racing content with a dedicated audience</li>
                <li>Earn credits through premium content</li>
                <li>Build your personal brand in the sim racing community</li>
                <li>Access advanced analytics and insights</li>
              </ul>

              <h3>Requirements</h3>
              <ul>
                <li>High-quality sim racing content (photos or videos)</li>
                <li>Regular content uploads</li>
                <li>Professional conduct and community engagement</li>
              </ul>
            </div>

            <Button 
              className="w-full"
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
            >
              {applyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Apply Now'
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
