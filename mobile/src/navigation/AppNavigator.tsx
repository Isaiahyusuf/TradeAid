import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

import { ScannerScreen } from '../screens/ScannerScreen';
import { RugShieldScreen } from '../screens/RugShieldScreen';
import { WhaleWatchScreen } from '../screens/WhaleWatchScreen';
import { MemeTrendScreen } from '../screens/MemeTrendScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { useAuth } from '../hooks/useAuth';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const getIcon = () => {
    switch (name) {
      case 'Scanner': return focused ? '◉' : '○';
      case 'RugShield': return focused ? '🛡' : '○';
      case 'WhaleWatch': return focused ? '🐋' : '○';
      case 'MemeTrend': return focused ? '📈' : '○';
      case 'Account': return focused ? '👤' : '○';
      default: return '○';
    }
  };

  return (
    <View style={styles.tabIconContainer}>
      <Text style={[styles.tabIcon, focused && styles.tabIconFocused]}>
        {getIcon()}
      </Text>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#22c55e',
        tabBarInactiveTintColor: '#6b7280',
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => (
          <TabIcon name={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Scanner" component={ScannerScreen} />
      <Tab.Screen name="RugShield" component={RugShieldScreen} />
      <Tab.Screen name="WhaleWatch" component={WhaleWatchScreen} />
      <Tab.Screen name="MemeTrend" component={MemeTrendScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0f0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#22c55e" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0a0f0a',
    borderTopColor: '#2a3f2a',
    borderTopWidth: 1,
    height: 85,
    paddingTop: 8,
    paddingBottom: 28,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 20,
    color: '#6b7280',
  },
  tabIconFocused: {
    color: '#22c55e',
  },
});
