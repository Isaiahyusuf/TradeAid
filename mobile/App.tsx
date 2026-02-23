import React, { useCallback, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthContext, useAuthState } from './src/hooks/useAuth';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { addNotificationListeners, initializeNotifications } from './src/services/notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
    },
  },
});

function AuthProvider({ children }: { children: React.ReactNode }) {
  const authState = useAuthState();

  return <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>;
}

function AppShell({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider style={{ flex: 1 }}>{children}</SafeAreaProvider>;
}

function LoadingScreen({ message }: { message?: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#9945FF" />
      <Text style={styles.loadingText}>{message ?? 'Starting MemeScannerAI...'}</Text>
    </View>
  );
}

function ErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error?.message || 'Unexpected error'}</Text>
      <Text onPress={reset} style={styles.errorAction}>
        Tap to retry
      </Text>
    </View>
  );
}

export default function App() {
  const [isReady, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const onReady = useCallback(() => setReady(true), []);
  const onReset = useCallback(() => {
    setError(null);
    setReady(false);
    setTimeout(() => setReady(true), 300);
  }, []);

  // Minimal async bootstrap (fonts, auth restore, etc.) can go here
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initializeNotifications();
        // placeholder for font loading / bootstrap
        await Promise.resolve();
        if (mounted) onReady();
      } catch (e) {
        if (mounted) setError(e as Error);
      }
    })();

    const cleanupListeners = addNotificationListeners(
      () => {},
      () => {}
    );

    return () => {
      mounted = false;
      cleanupListeners();
    };
  }, [onReady]);

  if (error) return <ErrorFallback error={error} reset={onReset} />;
  if (!isReady) return <LoadingScreen />;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell>
          <StatusBar style="light" />
          <AppNavigator />
        </AppShell>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#070809',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#ccc',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#070809',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  errorMessage: {
    color: '#ffdddd',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorAction: {
    color: '#9945FF',
    fontWeight: '600',
  },
});
