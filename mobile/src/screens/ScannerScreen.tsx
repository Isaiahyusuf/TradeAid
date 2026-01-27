import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { tokenService } from '../services/api';
import { TokenCard } from '../components/TokenCard';
import type { Token } from '../types';

type TabType = 'safePicks' | 'newest' | 'signals';

export function ScannerScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<TabType>('safePicks');
  const [refreshing, setRefreshing] = useState(false);

  const { data: safePicks, isLoading: loadingSafe, refetch: refetchSafe } = useQuery({
    queryKey: ['tokens', 'safe-picks'],
    queryFn: () => tokenService.getSafePicks().then(res => res.data),
  });

  const { data: hotTokens, isLoading: loadingHot, refetch: refetchHot } = useQuery({
    queryKey: ['tokens', 'hot'],
    queryFn: () => tokenService.getHot().then(res => res.data),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchSafe(), refetchHot()]);
    setRefreshing(false);
  };

  const handleScanNow = async () => {
    try {
      await tokenService.scanNow();
      onRefresh();
    } catch (error) {
      console.error('Scan failed:', error);
    }
  };

  const getCurrentData = (): Token[] => {
    switch (activeTab) {
      case 'safePicks':
        return safePicks || [];
      case 'newest':
        return hotTokens || [];
      default:
        return [];
    }
  };

  const isLoading = loadingSafe || loadingHot;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Alpha Scanner</Text>
        <TouchableOpacity style={styles.scanButton} onPress={handleScanNow}>
          <Text style={styles.scanButtonText}>Scan Now</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'safePicks' && styles.activeTab]}
          onPress={() => setActiveTab('safePicks')}
        >
          <Text style={[styles.tabText, activeTab === 'safePicks' && styles.activeTabText]}>
            Safe Picks
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'newest' && styles.activeTab]}
          onPress={() => setActiveTab('newest')}
        >
          <Text style={[styles.tabText, activeTab === 'newest' && styles.activeTabText]}>
            Hot Tokens
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#22c55e" />
        </View>
      ) : (
        <FlatList
          data={getCurrentData()}
          keyExtractor={(item) => item.address}
          renderItem={({ item }) => (
            <TokenCard
              token={item}
              onPress={() => navigation.navigate('TokenDetail', { address: item.address })}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#22c55e"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No tokens found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  scanButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scanButtonText: {
    color: '#000000',
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#1a1f1a',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#22c55e',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  activeTabText: {
    color: '#000000',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
  },
});
