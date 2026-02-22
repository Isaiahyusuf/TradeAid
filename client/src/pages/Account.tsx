import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { User, Shield, LogOut, Activity, TrendingUp, Camera, Save } from "lucide-react";

export default function Account() {
  const { user, logout, updateProfile } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUsername(user?.username || "");
    setDisplayName(user?.display_name || user?.username || "");
    setAvatarUrl(user?.avatar_url || "");
  }, [user]);

  const activeName = displayName || username || "User";
  const initials = activeName.slice(0, 2).toUpperCase();

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Use an image under 2MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setAvatarUrl(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!username.trim()) {
      toast({ title: "Username required", description: "Please enter a username.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({
        username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        avatar_url: avatarUrl.trim(),
      });
      toast({ title: "Profile updated", description: "Your profile changes were saved." });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not update profile.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-lg mx-auto space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-20 w-20">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={activeName} /> : null}
                <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-center">
                <h2 className="text-xl font-bold" data-testid="text-username">
                  @{username || "user"}
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-email">
                  {user?.email}
                </p>
                {user?.is_admin && (
                  <Badge variant="outline" className="mt-2 text-amber-400 border-amber-400/30">
                    <Shield className="w-3 h-3 mr-1" /> Admin
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-4 w-4" />
              Edit Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-username">Username</Label>
              <Input id="profile-username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="input-profile-username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-display-name">Display Name</Label>
              <Input id="profile-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="input-profile-display-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-avatar-url">Profile Picture URL</Label>
              <Input id="profile-avatar-url" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} data-testid="input-profile-avatar-url" />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarFile} className="hidden" />
              <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-avatar">
                <Camera className="h-4 w-4 mr-2" />
                Upload Picture
              </Button>
              <Button type="button" onClick={saveProfile} disabled={isSaving} data-testid="button-save-profile">
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-4 w-4" />
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Username</span>
              <span className="text-sm font-medium">{user?.username || username}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Display Name</span>
              <span className="text-sm font-medium">{user?.display_name || displayName || "-"}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">2FA</span>
              <Badge variant={user?.totp_enabled ? "default" : "outline"}>
                {user?.totp_enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Quick Links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href="/scanner">
              <Button variant="outline" className="w-full justify-start" data-testid="button-goto-scanner">
                <TrendingUp className="w-4 h-4 mr-2" />
                Alpha Scanner
              </Button>
            </a>
            <a href="/rugshield">
              <Button variant="outline" className="w-full justify-start" data-testid="button-goto-rugshield">
                <Shield className="w-4 h-4 mr-2" />
                Token Risk Scanner
              </Button>
            </a>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="w-full text-destructive border-destructive/20"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </Layout>
  );
}
