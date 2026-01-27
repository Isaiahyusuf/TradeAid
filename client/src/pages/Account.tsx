import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { User, Settings, Bell, Shield, Crown, Save, LogOut } from "lucide-react";
import { Link } from "wouter";

interface UserProfile {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  username: string | null;
  bio: string | null;
  favoriteChain: string | null;
  notificationsEnabled: boolean | null;
  emailAlertsEnabled: boolean | null;
  riskTolerance: string | null;
  createdAt: string | null;
}

export default function Account() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState<Partial<UserProfile>>({});
  const [isEditing, setIsEditing] = useState(false);

  const { data: profile, isLoading, isError } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: !!user,
  });

  const { data: subscription } = useQuery<{ plan: string; status: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const updateProfile = useMutation({
    mutationFn: async (updates: Partial<UserProfile>) => {
      return apiRequest("PATCH", "/api/profile", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({ title: "Profile updated", description: "Your changes have been saved." });
      setIsEditing(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update profile", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateProfile.mutate(formData);
  };

  const handleStartEdit = () => {
    setFormData({
      username: profile?.username || "",
      bio: profile?.bio || "",
      favoriteChain: profile?.favoriteChain || "solana",
      notificationsEnabled: profile?.notificationsEnabled ?? true,
      emailAlertsEnabled: profile?.emailAlertsEnabled ?? false,
      riskTolerance: profile?.riskTolerance || "medium",
    });
    setIsEditing(true);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-md mx-auto space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (isError || !profile) {
    return (
      <Layout>
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="pt-6 text-center">
              <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold mb-2">Unable to load profile</h2>
              <p className="text-sm text-muted-foreground mb-4">
                There was an issue loading your account information. Please try again.
              </p>
              <Button onClick={() => window.location.reload()} data-testid="button-retry">
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const displayName = profile.username || profile.firstName || profile.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Layout>
      <div className="max-w-lg mx-auto space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={profile?.profileImageUrl || undefined} alt={displayName} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                  {initials}
                </AvatarFallback>
              </Avatar>
              
              <div className="text-center">
                <h2 className="text-xl font-bold" data-testid="text-username">
                  @{displayName}
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-email">
                  {profile?.email}
                </p>
                {subscription?.plan === "pro" && (
                  <div className="inline-flex items-center gap-1 mt-2 px-2 py-1 bg-amber-500/20 text-amber-500 rounded-full text-xs">
                    <Crown className="h-3 w-3" />
                    Pro Member
                  </div>
                )}
              </div>

              {profile?.bio && (
                <p className="text-sm text-muted-foreground text-center" data-testid="text-bio">
                  {profile.bio}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-4 w-4" />
                Profile Details
              </CardTitle>
              <CardDescription>Manage your account information</CardDescription>
            </div>
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={handleStartEdit} data-testid="button-edit-profile">
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              {isEditing ? (
                <Input
                  id="username"
                  placeholder="Choose a username"
                  value={formData.username || ""}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  data-testid="input-username"
                />
              ) : (
                <p className="text-sm p-2 bg-muted rounded-md">{profile?.username || "Not set"}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              {isEditing ? (
                <Textarea
                  id="bio"
                  placeholder="Tell us about yourself..."
                  value={formData.bio || ""}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  rows={3}
                  data-testid="input-bio"
                />
              ) : (
                <p className="text-sm p-2 bg-muted rounded-md">{profile?.bio || "Not set"}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="favoriteChain">Favorite Chain</Label>
              {isEditing ? (
                <Select
                  value={formData.favoriteChain || "solana"}
                  onValueChange={(value) => setFormData({ ...formData, favoriteChain: value })}
                >
                  <SelectTrigger data-testid="select-chain">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solana">Solana</SelectItem>
                    <SelectItem value="ethereum">Ethereum</SelectItem>
                    <SelectItem value="bsc">BSC</SelectItem>
                    <SelectItem value="base">Base</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm p-2 bg-muted rounded-md capitalize">{profile?.favoriteChain || "Solana"}</p>
              )}
            </div>

            {isEditing && (
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={updateProfile.isPending} className="flex-1" data-testid="button-save-profile">
                  <Save className="h-4 w-4 mr-2" />
                  {updateProfile.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Push Notifications</p>
                <p className="text-xs text-muted-foreground">Get alerts for new signals</p>
              </div>
              <Switch
                checked={isEditing ? formData.notificationsEnabled ?? true : profile?.notificationsEnabled ?? true}
                onCheckedChange={(checked) => {
                  if (isEditing) {
                    setFormData({ ...formData, notificationsEnabled: checked });
                  } else {
                    updateProfile.mutate({ notificationsEnabled: checked });
                  }
                }}
                data-testid="switch-notifications"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Email Alerts</p>
                <p className="text-xs text-muted-foreground">Daily digest of opportunities</p>
              </div>
              <Switch
                checked={isEditing ? formData.emailAlertsEnabled ?? false : profile?.emailAlertsEnabled ?? false}
                onCheckedChange={(checked) => {
                  if (isEditing) {
                    setFormData({ ...formData, emailAlertsEnabled: checked });
                  } else {
                    updateProfile.mutate({ emailAlertsEnabled: checked });
                  }
                }}
                data-testid="switch-email-alerts"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Risk Preferences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Risk Tolerance</Label>
              {isEditing ? (
                <Select
                  value={formData.riskTolerance || "medium"}
                  onValueChange={(value) => setFormData({ ...formData, riskTolerance: value })}
                >
                  <SelectTrigger data-testid="select-risk">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low - Conservative plays only</SelectItem>
                    <SelectItem value="medium">Medium - Balanced approach</SelectItem>
                    <SelectItem value="high">High - Degen mode</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm p-2 bg-muted rounded-md capitalize">
                  {profile?.riskTolerance === "low" && "Low - Conservative plays only"}
                  {profile?.riskTolerance === "medium" && "Medium - Balanced approach"}
                  {profile?.riskTolerance === "high" && "High - Degen mode"}
                  {!profile?.riskTolerance && "Medium - Balanced approach"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="w-full text-destructive border-destructive/20 hover:bg-destructive/10"
          onClick={() => logout()}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>

        <Link href="/subscription">
          <Button className="w-full" variant="outline" data-testid="button-upgrade">
            <Crown className="h-4 w-4 mr-2 text-amber-500" />
            {subscription?.plan === "pro" ? "Manage Subscription" : "Upgrade to Pro"}
          </Button>
        </Link>
      </div>
    </Layout>
  );
}
