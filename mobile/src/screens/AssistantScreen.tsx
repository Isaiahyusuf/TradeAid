import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function AssistantScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>DoctorTrade</Text>
          <Text style={styles.heroSubtitle}>Cross-chain AI trading intelligence</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status</Text>
          <Text style={styles.cardText}>DoctorStrange is active on mobile and ready to assist.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What it does</Text>
          <Text style={styles.cardText}>• Interprets market confidence and rug risk</Text>
          <Text style={styles.cardText}>• Uses cross-chain context for smarter decisions</Text>
          <Text style={styles.cardText}>• Keeps risk-first recommendations</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Coming next</Text>
          <Text style={styles.cardText}>Live mobile trade controls and assistant Q&A panel.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  heroCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3b2d5f',
    backgroundColor: '#15121d',
    padding: 16,
  },
  heroTitle: {
    color: '#d8c4ff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  heroSubtitle: {
    marginTop: 4,
    color: '#9ca3af',
    fontSize: 13,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3f2a',
    backgroundColor: '#121712',
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  cardText: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
  },
});
