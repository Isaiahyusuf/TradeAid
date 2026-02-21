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

  const { data: tokensData, isLoading: loadingTokens, refetch: refetchTokens } = useQuery({
    queryKey: ['tokens', activeTab],
    queryFn: async () => {
      const params = activeTab === 'safePicks' 
        ? { limit: 50 }
        : { sort_by: 'created_at', limit: 50 };
      const response = await tokenService.getAll(params);
      return response.data.tokens || [];
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetchTokens();
    setRefreshing(false);
  };

  const getCurrentData = (): Token[] => {
    return tokensData || [];
  };

  const isLoading = loadingTokens;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Alpha Scanner</Text>
        <TouchableOpacity style={styles.scanButton} onPress={onRefresh}>
          <Text style={styles.scanButtonText}>Refresh</Text>
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
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TokenCard
              token={item}
              onPress={() => navigation.navigate('TokenDetail', { 
                chain: item.chain, 
                address: item.contract_address 
              })}
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
