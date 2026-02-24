import { useLocation } from "wouter";
import { 
  ShieldCheck, Eye, TrendingUp, LayoutDashboard, 
  LogOut, User, Radar, Bell, Lock, Bot, Wallet
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TradeAidLogo } from "@/components/brand/TradeAidLogo";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Scanner", href: "/scanner", icon: Radar },
  { label: "RugShield", href: "/rugshield", icon: ShieldCheck },
  { label: "WhaleWatch", href: "/whalewatch", icon: Eye },
  { label: "Safe Buy", href: "/safebuy", icon: Lock },
  { label: "Tokens", href: "/memetrend", icon: TrendingUp },
  { label: "DoctorTrade", href: "/doctortrade", icon: Bot },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Subscription", href: "/subscription", icon: Bell },
  { label: "Account", href: "/account", icon: User },
];

const getNavTestId = (label: string) => `nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const getMobileNavTestId = (label: string) => `mobile-nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-card/90 backdrop-blur-xl border-r border-primary/15 hidden md:flex flex-col z-40">
      <div className="p-6 border-b border-border">
        <TradeAidLogo />
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto p-4 pr-2 space-y-2 app-scroll">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          const isDoctorStrange = item.href === "/doctortrade";
          
          return (
            <button
              key={item.href}
              onClick={() => setLocation(item.href)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium border border-transparent",
                isActive 
                  ? "bg-gradient-to-r from-primary/15 via-accent/10 to-background text-primary border-primary/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]" 
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5 hover:border-primary/20",
                isDoctorStrange && "doctorstrange-font"
              )}
              data-testid={getNavTestId(item.label)}
            >
              <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        {user && (
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {user.username?.charAt(0)?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user.username || "User"}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [location, setLocation] = useLocation();
  
  return (
    <nav className="fixed bottom-0 left-0 w-full bg-card/95 backdrop-blur-lg border-t border-primary/20 md:hidden z-50 px-2 py-2 safe-area-bottom">
      <div className="flex justify-around items-center max-w-xl mx-auto overflow-x-auto scrollbar-hide">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          const isDoctorStrange = item.href === "/doctortrade";
          const mobileLabel = isDoctorStrange ? "Doctor" : item.label;
          
          return (
            <button
              key={item.href}
              onClick={() => setLocation(item.href)}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[56px] border border-transparent",
                isActive ? "text-primary bg-primary/10 border-primary/25" : "text-muted-foreground",
                isDoctorStrange && "doctorstrange-font"
              )} 
              data-testid={getMobileNavTestId(item.label)}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">
                {mobileLabel}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
