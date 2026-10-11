import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Series, InsertSeries, UpdateSeries, updateSeriesSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Pencil, Trash, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function SeriesManager() {
  const [editingSeries, setEditingSeries] = useState<Series | null>(null);
  const [newLogo, setNewLogo] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: series, isLoading } = useQuery<Series[]>({
    queryKey: ["/api/series"],
  });

  const createSeriesMutation = useMutation({
    mutationFn: async (data: InsertSeries) => {
      const response = await apiRequest("POST", "/api/series", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      setEditingSeries(null);
      setNewLogo(null);
      toast({
        title: "Success",
        description: "Series created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSeriesMutation = useMutation({
    retry: false,
    mutationFn: async ({ id, changes }: { id: number; changes: UpdateSeries }) => {
      const response = await apiRequest("PUT", `/api/series/${id}`, changes);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      setEditingSeries(null);
      setNewLogo(null);
      setFormError(null);
      toast({
        title: "Success",
        description: "Series updated successfully",
      });
    },
    onError: (error) => {
      let message = "Could not save the series. Please try again.";
      try {
        const data = JSON.parse(error.message);
        if (typeof data.error === "string") message = data.error;
      } catch { /* Network failures have no safe server message. */ }
      setFormError(message);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const deleteSeriesMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/series/${id}`);
    },
    onSuccess: () => {
      // Invalidate series queries
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });

      // Also invalidate events queries since they may reference the deleted series
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });

      toast({
        title: "Success",
        description: "Series deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check if the file is a PNG
    if (!file.type.includes('png')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PNG file with transparent background",
        variant: "destructive",
      });
      return;
    }

    // Convert to base64 for storage and preview
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setNewLogo(file);
        if (editingSeries) {
          setEditingSeries({ ...editingSeries, logo: reader.result });
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Only validate the name field
    if (!editingSeries?.name) {
      toast({
        title: "Missing fields",
        description: "Please enter a series name",
        variant: "destructive",
      });
      return;
    }

    if (editingSeries.id) {
      const parsed = updateSeriesSchema.safeParse({
        name: editingSeries.name,
        logo: editingSeries.logo,
        description: editingSeries.description,
      });
      if (!parsed.success) {
        setFormError(parsed.error.issues.map(issue => issue.message).join(" "));
        return;
      }
      setFormError(null);
      updateSeriesMutation.mutate({ id: editingSeries.id, changes: parsed.data });
    } else {
      createSeriesMutation.mutate(editingSeries as InsertSeries);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-2xl font-bold">Race Series Management</h2>
        <Button 
          onClick={() => { setFormError(null); setEditingSeries({ name: '', logo: '', description: '' } as Series); }}
          className="bg-primary text-black hover:bg-primary/90"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Series
        </Button>
      </div>

      {editingSeries && (
        <Card className="bg-black/40 border-primary/20">
          <CardHeader>
            <CardTitle>
              {editingSeries.id ? 'Edit Series' : 'New Series'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              <div>
                 <Input
                   aria-label="Series name"
                  placeholder="Series Name"
                  value={editingSeries.name}
                  onChange={(e) => setEditingSeries({ ...editingSeries, name: e.target.value })}
                />
              </div>
              <div>
                <Textarea
                  placeholder="Description (optional)"
                  value={editingSeries.description || ''}
                  onChange={(e) => setEditingSeries({ ...editingSeries, description: e.target.value })}
                />
              </div>
              <div>
                 <Input
                   aria-label="Series logo"
                  type="file"
                  accept=".png"
                   className="max-w-full"
                  onChange={handleLogoChange}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Upload a PNG logo with transparent background (optional)
                </p>
              </div>
              {editingSeries.logo && (
                <div className="bg-white/5 rounded-lg p-4">
                  <img
                    src={editingSeries.logo}
                    alt="Logo preview"
                    className="h-12 object-contain"
                  />
                </div>
              )}
               <div className="flex flex-wrap gap-2 pt-4">
                <Button
                  type="submit"
                  disabled={createSeriesMutation.isPending || updateSeriesMutation.isPending}
                >
                  {(createSeriesMutation.isPending || updateSeriesMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingSeries.id ? 'Update' : 'Create'} Series
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setFormError(null); setEditingSeries(null); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {series?.map((s) => (
          <Card key={s.id} className="bg-black/40 border-primary/20">
             <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
               <div className="flex min-w-0 items-center gap-4">
                {s.logo ? (
                  <img
                    src={s.logo}
                    alt={s.name}
                     className="h-8 w-8 shrink-0 object-contain"
                  />
                ) : (
                   <div className="h-8 w-8 shrink-0 bg-primary/20 rounded flex items-center justify-center">
                    <Trophy className="h-4 w-4 text-primary" />
                  </div>
                )}
                 <div className="min-w-0">
                   <h3 className="break-words font-semibold">{s.name}</h3>
                  {s.description && (
                     <p className="break-words text-sm text-muted-foreground">{s.description}</p>
                  )}
                </div>
              </div>
               <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                   aria-label={`Edit series ${s.name}`}
                  onClick={() => { setFormError(null); setEditingSeries(s); }}
                >
                   <Pencil className="mr-1 h-4 w-4" /> Edit
                </Button>
                <Button
                  variant="ghost"
                   aria-label={`Delete series ${s.name}`}
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this series?')) {
                      deleteSeriesMutation.mutate(s.id);
                    }
                  }}
                >
                   <Trash className="mr-1 h-4 w-4" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}