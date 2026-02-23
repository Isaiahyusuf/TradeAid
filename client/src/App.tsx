import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, AuthProvider } from "@/hooks/use-auth";
import { ChainProvider } from "@/hooks/use-chain";
import AuthPage from "@/pages/AuthPage";
import Dashboard from "@/pages/Dashboard";
import AlphaScanner from "@/pages/AlphaScanner";
import RugShield from "@/pages/RugShield";
import WhaleWatch from "@/pages/WhaleWatch";
import MemeTrend from "@/pages/MemeTrend";
import SafeBuy from "@/pages/SafeBuy";
import AssistantPage from "@/pages/Assistant";
import Account from "@/pages/Account";
import Subscription from "@/pages/Subscription";
import NotFound from "@/pages/not-found";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { useLocation } from "wouter";

function GlobalAssistantLauncher() {
  const [location, setLocation] = useLocation();
  const isAssistantPage = location === "/assistant" || location === "/doctorstrange";

  return (
    <Button
      type="button"
      onClick={() => setLocation("/assistant")}
      className="fixed left-4 md:left-6 bottom-6 z-[100] gap-2 doctorstrange-font bg-gradient-to-r from-accent/90 to-primary/90 text-white border border-primary/40 shadow-[0_0_24px_rgba(153,69,255,0.35)] hover:from-accent hover:to-primary"
      data-testid="button-global-doctorstrange"
    >
      <Bot className="h-4 w-4 doctorstrange-sigil" />
      <span>{isAssistantPage ? "DoctorStrange Active" : "Open DoctorStrange"}</span>
    </Button>
  );
}

function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/scanner" component={AlphaScanner} />
      <Route path="/rugshield" component={RugShield} />
      <Route path="/whalewatch" component={WhaleWatch} />
      <Route path="/memetrend" component={MemeTrend} />
      <Route path="/safebuy" component={SafeBuy} />
      <Route path="/assistant" component={AssistantPage} />
      <Route path="/doctorstrange" component={AssistantPage} />
      <Route path="/account" component={Account} />
      <Route path="/subscription" component={Subscription} />
      <Route component={NotFound} />
    </Switch>
  );
}

function UnauthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={AuthPage} />
      <Route component={AuthPage} />
    </Switch>
  );
}

function AppContent() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md p-8">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
          <Skeleton className="h-32 w-full mt-8" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <UnauthenticatedRouter />;
  }

  return (
    <>
      <AuthenticatedRouter />
      <GlobalAssistantLauncher />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ChainProvider>
            <Toaster />
            <AppContent />
          </ChainProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
