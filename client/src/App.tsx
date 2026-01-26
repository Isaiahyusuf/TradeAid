import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import AlphaScanner from "@/pages/AlphaScanner";
import RugShield from "@/pages/RugShield";
import WhaleWatch from "@/pages/WhaleWatch";
import MemeTrend from "@/pages/MemeTrend";
import Subscription from "@/pages/Subscription";
import NotFound from "@/pages/not-found";
import { FloatingMemeTrend } from "@/components/FloatingMemeTrend";
import { Skeleton } from "@/components/ui/skeleton";

function AuthenticatedRouter() {
  return (
    <>
      <Switch>
        <Route path="/" component={AlphaScanner} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/scanner" component={AlphaScanner} />
        <Route path="/rugshield" component={RugShield} />
        <Route path="/whalewatch" component={WhaleWatch} />
        <Route path="/memetrend" component={MemeTrend} />
        <Route path="/subscription" component={Subscription} />
        <Route component={NotFound} />
      </Switch>
      <FloatingMemeTrend />
    </>
  );
}

function UnauthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route component={Landing} />
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
        <Toaster />
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
