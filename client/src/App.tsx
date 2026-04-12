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
const DoctorTradePage = lazy(() => import("@/pages/DoctorTrade"));
const WalletPage = lazy(() => import("@/pages/Wallet"));

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
        <Route path="/" component={DoctorTradePage} />
        <Route path="/wallet" component={WalletPage} />
        <Route path="/doctortrade" component={DoctorTradePage} />
        <Route component={DoctorTradePage} />
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
