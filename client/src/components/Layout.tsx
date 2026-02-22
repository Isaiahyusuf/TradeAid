import { Sidebar, MobileNav } from "./Sidebar";
import { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar />
      <main className="flex-1 md:ml-64 pb-20 md:pb-0 relative overflow-x-hidden">
        {/* Decorative background gradients */}
        <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 p-4 md:p-6 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 bg-card/70 backdrop-blur-md border-primary/20 hover:border-primary/40"
                data-testid="button-open-profile-menu"
              >
                <Avatar className="h-6 w-6">
                  {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={user.display_name || user.username} /> : null}
                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                    {(user?.display_name || user?.username || "U").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline">Profile</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" data-testid="menu-profile-dropdown">
              <DropdownMenuItem onClick={() => setLocation("/account")} data-testid="menu-item-account">
                <User className="h-4 w-4 mr-2" />
                Account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={logout}
                data-testid="menu-item-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative z-10 p-4 md:p-8 pt-16 md:pt-20 pr-20 md:pr-28 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
