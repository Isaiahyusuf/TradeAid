import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { whaleService } from '../services/api';

export function WhaleWatchScreen() {
  const { data: alerts, isLoading, refetch } = useQuery({
    queryKey: ['whalewatch', 'alerts'],
    queryFn: () => whaleService.getAlerts().then((res: any) => res.data?.alerts || []),
  });

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Whale Watch</Text>
      <Text style={styles.subtitle}>Track wallet movements</Text>

      <FlatList
        data={alerts}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }) => (
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <View style={[styles.alertBadge, { 
                backgroundColor: item.severity === 'high' ? '#ef444420' : 
                                 item.severity === 'medium' ? '#eab30820' : '#22c55e20' 
              }]}>
                <Text style={[styles.alertType, { 
                  color: item.severity === 'high' ? '#ef4444' : 
                         item.severity === 'medium' ? '#eab308' : '#22c55e' 
                }]}>
                  {item.alert_type.replace('_', ' ').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.alertChain}>{item.chain}</Text>
            </View>
            <Text style={styles.alertTitle}>{item.title}</Text>
            {item.message && <Text style={styles.alertMessage}>{item.message}</Text>}
            <Text style={styles.alertTime}>
              {new Date(item.created_at).toLocaleString()}
            </Text>
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No whale alerts yet</Text>
            <Text style={styles.emptySubtext}>Wallet movements will appear here</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  alertCard: {
    backgroundColor: '#1a1f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  alertType: {
    fontSize: 12,
    fontWeight: '700',
  },
  alertChain: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  alertMessage: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  alertTime: {
    fontSize: 12,
    color: '#6b7280',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
});
