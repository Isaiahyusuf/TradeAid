import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, AuthProvider } from "@/hooks/use-auth";
import { ChainProvider } from "@/hooks/use-chain";
import { Suspense, lazy } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const AuthPage = lazy(() => import("@/pages/AuthPage"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AlphaScanner = lazy(() => import("@/pages/AlphaScanner"));
const RugShield = lazy(() => import("@/pages/RugShield"));
const WhaleWatch = lazy(() => import("@/pages/WhaleWatch"));
const MemeTrend = lazy(() => import("@/pages/MemeTrend"));
const SafeBuy = lazy(() => import("@/pages/SafeBuy"));
const AssistantPage = lazy(() => import("@/pages/Assistant"));
const DoctorTradePage = lazy(() => import("@/pages/DoctorTrade"));
const Account = lazy(() => import("@/pages/Account"));
const Subscription = lazy(() => import("@/pages/Subscription"));
const Disclaimer = lazy(() => import("@/pages/Disclaimer"));
const NotFound = lazy(() => import("@/pages/not-found"));

function RouteLoadingFallback() {
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

function AuthenticatedRouter() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/scanner" component={AlphaScanner} />
        <Route path="/rugshield" component={RugShield} />
        <Route path="/whalewatch" component={WhaleWatch} />
        <Route path="/memetrend" component={MemeTrend} />
        <Route path="/safebuy" component={SafeBuy} />
        <Route path="/assistant" component={AssistantPage} />
        <Route path="/wallet" component={DoctorTradePage} />
        <Route path="/doctorstrange" component={AssistantPage} />
        <Route path="/doctortrade" component={DoctorTradePage} />
        <Route path="/account" component={Account} />
        <Route path="/settings" component={Account} />
        <Route path="/subscription" component={Subscription} />
        <Route path="/disclaimer" component={Disclaimer} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function UnauthenticatedRouter() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Switch>
        <Route path="/" component={AuthPage} />
        <Route component={AuthPage} />
      </Switch>
    </Suspense>
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
