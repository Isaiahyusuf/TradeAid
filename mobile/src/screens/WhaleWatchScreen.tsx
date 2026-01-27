import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { whaleService } from '../services/api';
import type { TrackedWallet, WalletAlert } from '../types';

export function WhaleWatchScreen() {
  const { data: wallets, isLoading, refetch } = useQuery({
    queryKey: ['whalewatch', 'wallets'],
    queryFn: () => whaleService.getWallets().then(res => res.data),
  });

  const { data: alerts } = useQuery({
    queryKey: ['whalewatch', 'alerts'],
    queryFn: () => whaleService.getAlerts().then(res => res.data),
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
      <Text style={styles.subtitle}>Track top traders</Text>

      <FlatList
        data={wallets}
        keyExtractor={(item: TrackedWallet) => item.address}
        renderItem={({ item }) => (
          <View style={styles.walletCard}>
            <View style={styles.walletHeader}>
              <Text style={styles.walletLabel}>{item.label}</Text>
              <Text style={styles.winRate}>{item.winRate}% Win</Text>
            </View>
            <Text style={styles.walletAddress} numberOfLines={1}>{item.address}</Text>
            <Text style={styles.profit}>{item.totalProfit}</Text>
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />
        }
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          alerts && alerts.length > 0 ? (
            <View style={styles.alertsSection}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              {alerts.slice(0, 5).map((alert: WalletAlert) => (
                <View key={alert.id} style={styles.alertItem}>
                  <View style={[styles.alertBadge, { backgroundColor: alert.type === 'BUY' ? '#22c55e20' : '#ef444420' }]}>
                    <Text style={[styles.alertType, { color: alert.type === 'BUY' ? '#22c55e' : '#ef4444' }]}>
                      {alert.type}
                    </Text>
                  </View>
                  <Text style={styles.alertSymbol}>{alert.tokenSymbol}</Text>
                  <Text style={styles.alertAmount}>{alert.amount}</Text>
                </View>
              ))}
            </View>
          ) : null
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
  alertsSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a3f2a',
    gap: 12,
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
  alertSymbol: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  alertAmount: {
    fontSize: 14,
    color: '#9ca3af',
  },
  walletCard: {
    backgroundColor: '#1a1f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  walletLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  winRate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
  },
  walletAddress: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  profit: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
