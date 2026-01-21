import { Link, useLocation } from "wouter";
import { 
  ShieldCheck, Eye, TrendingUp, LayoutDashboard, 
  Zap, LogOut, User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "RugShield", href: "/rugshield", icon: ShieldCheck },
  { label: "WhaleWatch", href: "/whalewatch", icon: Eye },
  { label: "MemeTrend", href: "/memetrend", icon: TrendingUp },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-card border-r border-border hidden md:flex flex-col z-40">
      <div className="p-6 border-b border-border">
        <h1 className="text-2xl font-bold font-sans tracking-tighter">
          <span className="text-primary">Meme</span>Scanner<span className="text-accent">AI</span>
        </h1>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          
          return (
            <Link key={item.href} href={item.href}>
              <button
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium",
                  isActive 
                    ? "bg-primary/10 text-primary shadow-[0_0_15px_rgba(34,197,94,0.15)]" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.label}
              </button>
            </Link>
          );
        })}

        <Link href="/subscription">
          <button
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium mt-4",
              location === "/subscription"
                ? "bg-accent/10 text-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
            data-testid="nav-subscription"
          >
            <Zap className={cn("w-5 h-5", location === "/subscription" ? "text-accent" : "text-muted-foreground")} />
            Subscription
          </button>
        </Link>
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        {user && (
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.profileImageUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {user.firstName?.charAt(0) || user.email?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user.firstName || user.email?.split("@")[0] || "User"}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        )}
        <a href="/api/logout" className="block">
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground" data-testid="button-logout">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </a>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [location] = useLocation();
  
  return (
    <nav className="fixed bottom-0 left-0 w-full bg-card border-t border-border md:hidden z-50 px-4 py-2 flex justify-between items-center safe-area-bottom">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.href;
        
        return (
          <Link key={item.href} href={item.href}>
            <button className="flex flex-col items-center gap-1 p-2" data-testid={`mobile-nav-${item.label.toLowerCase()}`}>
              <Icon className={cn("w-6 h-6 transition-colors", isActive ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("text-[10px] font-medium", isActive ? "text-primary" : "text-muted-foreground")}>
                {item.label}
              </span>
            </button>
          </Link>
        );
      })}
      <Link href="/subscription">
        <button className="flex flex-col items-center gap-1 p-2" data-testid="mobile-nav-subscription">
          <Zap className={cn("w-6 h-6 transition-colors", location === "/subscription" ? "text-accent" : "text-muted-foreground")} />
          <span className={cn("text-[10px] font-medium", location === "/subscription" ? "text-accent" : "text-muted-foreground")}>
            Pro
          </span>
        </button>
      </Link>
    </nav>
  );
}
