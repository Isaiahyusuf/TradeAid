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
      <Route path="/doctortrade" component={AssistantPage} />
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

  return isAuthenticated ? <AuthenticatedRouter /> : <UnauthenticatedRouter />;
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
