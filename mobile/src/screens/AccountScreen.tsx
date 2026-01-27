import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { UserProfile } from '../types';

export function AccountScreen() {
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<UserProfile>>({});

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileService.get().then(res => res.data),
  });

  const updateProfile = useMutation({
    mutationFn: (data: Partial<UserProfile>) => profileService.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setIsEditing(false);
      Alert.alert('Success', 'Profile updated successfully');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update profile');
    },
  });

  const handleStartEdit = () => {
    setFormData({
      username: profile?.username || '',
      bio: profile?.bio || '',
      favoriteChain: profile?.favoriteChain || 'solana',
      notificationsEnabled: profile?.notificationsEnabled ?? true,
      emailAlertsEnabled: profile?.emailAlertsEnabled ?? false,
      riskTolerance: profile?.riskTolerance || 'medium',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateProfile.mutate(formData);
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile?.username || profile?.firstName || profile?.email?.split('@')[0] || 'User';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName.slice(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          {profile?.email && <Text style={styles.email}>{profile.email}</Text>}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile</Text>
            {!isEditing && (
              <TouchableOpacity onPress={handleStartEdit}>
                <Text style={styles.editButton}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {isEditing ? (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={styles.input}
                  value={formData.username}
                  onChangeText={(text) => setFormData({ ...formData, username: text })}
                  placeholderTextColor="#6b7280"
                  maxLength={50}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Bio</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={formData.bio}
                  onChangeText={(text) => setFormData({ ...formData, bio: text })}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor="#6b7280"
                  maxLength={500}
                />
              </View>
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setIsEditing(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Username</Text>
                <Text style={styles.infoValue}>{profile?.username || 'Not set'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Bio</Text>
                <Text style={styles.infoValue}>{profile?.bio || 'No bio yet'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Favorite Chain</Text>
                <Text style={styles.infoValue}>{profile?.favoriteChain || 'Solana'}</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Push Notifications</Text>
            <Switch
              value={isEditing ? formData.notificationsEnabled : profile?.notificationsEnabled}
              onValueChange={(value) => {
                if (isEditing) {
                  setFormData({ ...formData, notificationsEnabled: value });
                }
              }}
              disabled={!isEditing}
              trackColor={{ false: '#3a3a3a', true: '#22c55e' }}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Email Alerts</Text>
            <Switch
              value={isEditing ? formData.emailAlertsEnabled : profile?.emailAlertsEnabled}
              onValueChange={(value) => {
                if (isEditing) {
                  setFormData({ ...formData, emailAlertsEnabled: value });
                }
              }}
              disabled={!isEditing}
              trackColor={{ false: '#3a3a3a', true: '#22c55e' }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Risk Preference</Text>
          <Text style={styles.riskValue}>
            {(isEditing ? formData.riskTolerance : profile?.riskTolerance)?.toUpperCase() || 'MEDIUM'}
          </Text>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#6b7280',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  displayName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  email: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#1a1f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  editButton: {
    color: '#22c55e',
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0a0f0a',
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#2a3f2a',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2a3f2a',
  },
  cancelButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#22c55e',
  },
  saveButtonText: {
    color: '#000000',
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a3f2a',
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: 14,
    color: '#ffffff',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  switchLabel: {
    fontSize: 14,
    color: '#ffffff',
  },
  riskValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#22c55e',
    marginTop: 8,
  },
  logoutButton: {
    backgroundColor: '#dc2626',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  logoutButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
});
