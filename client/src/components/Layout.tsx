import { Sidebar, MobileNav } from "./Sidebar";
import { ReactNode, useEffect, useMemo, useState, type CSSProperties } from "react";
import { TradeAidLogo } from "@/components/brand/TradeAidLogo";
import { useAuth } from "@/hooks/use-auth";
import { useChain, SUPPORTED_CHAINS, type AppChain } from "@/hooks/use-chain";
import { useLocation } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bot, LogOut, Settings2 } from "lucide-react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";

const DOCTORTRADE_POSITION_KEY = "doctortrade-launcher-position-v1";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { chain, setChain } = useChain();
  const [location, setLocation] = useLocation();
  const [parallax, setParallax] = useState({ x: 50, y: 50 });
  const launcherX = useMotionValue(0);
  const launcherY = useMotionValue(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DOCTORTRADE_POSITION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      launcherX.set(Number(parsed.x || 0));
      launcherY.set(Number(parsed.y || 0));
    } catch {
    }
  }, [launcherX, launcherY]);

  const persistLauncherPosition = () => {
    try {
      window.localStorage.setItem(
        DOCTORTRADE_POSITION_KEY,
        JSON.stringify({ x: launcherX.get(), y: launcherY.get() })
      );
    } catch {
    }
  };

  const parallaxStyle = useMemo(
    () => ({
      "--mx": `${parallax.x}%`,
      "--my": `${parallax.y}%`,
    }) as CSSProperties,
    [parallax.x, parallax.y]
  );

  const handlePointerMove = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setParallax({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
  };

  const onDoctorTradePage = location === "/doctortrade";

  return (
    <div className="min-h-screen bg-background text-foreground flex solana-shell">
      <Sidebar />
      <main
        className="flex-1 md:ml-64 h-screen overflow-y-auto overflow-x-hidden pb-28 md:pb-8 relative wow-shell app-scroll"
        onMouseMove={handlePointerMove}
        style={parallaxStyle}
      >
        {/* Decorative background gradients */}
        <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-primary/10 to-transparent pointer-events-none animate-float" />
        <div className="absolute -top-16 right-10 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none animate-soft-pulse wow-orb" />
        <div className="absolute top-20 -left-20 w-56 h-56 rounded-full bg-primary/10 blur-3xl pointer-events-none animate-orbital wow-orb wow-orb-delay" />
        <div className="absolute inset-0 pointer-events-none wow-grid" />
        <div className="absolute inset-0 pointer-events-none wow-spotlight" />
        <div className="absolute inset-x-0 top-24 h-40 bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 p-4 md:p-6 z-20">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="inline-flex items-center rounded-md px-2 py-1 bg-card/70 backdrop-blur-md border border-primary/20 hover:border-primary/40"
              data-testid="button-global-logo-home"
            >
              <TradeAidLogo withText={false} className="scale-90" />
            </button>
            <Select value={chain} onValueChange={(value) => setChain(value as AppChain)}>
              <SelectTrigger className="w-[150px] bg-card/70 backdrop-blur-md border-primary/20 hover:border-primary/40" data-testid="select-global-chain">
                <SelectValue placeholder="Select chain" />
              </SelectTrigger>
              <SelectContent align="end">
                {SUPPORTED_CHAINS.map((item) => (
                  <SelectItem key={item} value={item} className="capitalize">
                    {item === "all" ? "All Chains" : item === "bsc" ? "BNB Chain" : item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 bg-card/70 backdrop-blur-md border-primary/20 hover:border-primary/40 solana-card"
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
                  <Settings2 className="h-4 w-4 mr-2" />
                  Settings
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
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location}
            className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-8 pt-20 md:pt-20 pb-6 md:pb-8 animate-fade-in-up tilt-shell"
            initial={{ opacity: 0, y: 16, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.995 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>

        {!onDoctorTradePage && (
          <motion.div
            drag
            dragMomentum={false}
            whileTap={{ scale: 1.03 }}
            style={{ x: launcherX, y: launcherY }}
            onDragEnd={persistLauncherPosition}
            className="fixed right-4 md:right-6 bottom-28 md:bottom-6 z-[70] cursor-grab active:cursor-grabbing"
          >
            <Button
              type="button"
              onClick={() => setLocation("/doctortrade")}
              className="gap-2 doctorstrange-font bg-gradient-to-r from-accent/90 to-primary/90 text-white border border-primary/40 shadow-[0_0_24px_rgba(153,69,255,0.35)] hover:from-accent hover:to-primary"
              data-testid="button-floating-doctorstrange"
            >
              <Bot className="h-4 w-4 doctorstrange-sigil" />
              <span>Open DoctorTrade</span>
            </Button>
          </motion.div>
        )}
      </main>
      <MobileNav />
    </div>
  );
}
