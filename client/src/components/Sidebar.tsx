import { useLocation } from "wouter";
import { 
  ShieldCheck, Eye, TrendingUp, LayoutDashboard, 
  LogOut, User, Radar, Bell, Lock, Bot, Wallet, ChevronRight
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
  { label: "Settings", href: "/account", icon: User },
];

const getNavTestId = (label: string) => `nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const getMobileNavTestId = (label: string) => `mobile-nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 glass-effect-strong hidden md:flex flex-col z-40 border-r border-white/10">
      <div className="p-6 border-b border-white/10 space-y-2">
        <TradeAidLogo />
        <p className="text-xs text-muted-foreground font-medium">Trading Intelligence</p>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto p-4 pr-2 space-y-1 app-scroll">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          const isDoctorStrange = item.href === "/doctortrade";
          
          return (
            <button
              key={item.href}
              onClick={() => setLocation(item.href)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 font-medium border group relative overflow-hidden",
                isActive 
                  ? "bg-gradient-to-r from-primary/20 via-accent/10 to-background text-primary border-primary/40 shadow-[0_0_20px_rgba(34,197,94,0.2)]" 
                  : "text-muted-foreground hover:text-foreground hover:bg-white/8 hover:border-primary/30 border-transparent"
              )}
              data-testid={getNavTestId(item.label)}
            >
              <Icon className={cn(
                "w-5 h-5 transition-transform duration-300 group-hover:scale-110",
                isActive ? "text-primary" : "text-muted-foreground"
              )} />
              <span className="flex-1 text-left">{item.label}</span>
              {isActive && <ChevronRight className="w-4 h-4 opacity-60" />}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 space-y-3">
        {user && (
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border border-primary/30">
                <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-primary text-sm font-bold">
                  {user.username?.charAt(0)?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {user.username || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-white/8 transition-all duration-300"
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
    <nav className="fixed bottom-0 left-0 w-full glass-effect md:hidden z-50 px-2 py-3 safe-area-bottom border-t border-white/10">
      <div className="flex justify-around items-center max-w-xl mx-auto overflow-x-auto scrollbar-hide gap-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          const isDoctorStrange = item.href === "/doctortrade";
          const mobileLabel = isDoctorStrange ? "Doctor" : item.label.length > 8 ? item.label.split(" ")[0] : item.label;
          
          return (
            <button
              key={item.href}
              onClick={() => setLocation(item.href)}
              className={cn(
                "flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg transition-all duration-300 min-w-[56px] border backdrop-blur-sm",
                isActive ? "text-primary bg-primary/15 border-primary/30 shadow-[0_0_12px_rgba(34,197,94,0.15)]" : "text-muted-foreground hover:text-foreground hover:bg-white/8 hover:border-primary/20 border-transparent"
              )} 
              data-testid={getMobileNavTestId(item.label)}
            >
              <Icon className={cn("w-5 h-5 transition-transform duration-300", isActive && "scale-110")} />
              <span className="text-[10px] font-semibold text-center leading-tight">
                {mobileLabel}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
