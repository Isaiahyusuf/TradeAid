import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User, Shield, LogOut, Activity, TrendingUp } from "lucide-react";

export default function Account() {
  const { user, logout } = useAuth();

  const displayName = user?.username || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Layout>
      <div className="max-w-lg mx-auto space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-center">
                <h2 className="text-xl font-bold" data-testid="text-username">
                  @{displayName}
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
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Username</span>
              <span className="text-sm font-medium">{user?.username}</span>
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
