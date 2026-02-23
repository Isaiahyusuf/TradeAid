import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function initializeNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#22c55e',
        sound: 'default',
      });
    }

    const permissions = await Notifications.getPermissionsAsync();
    let finalStatus = permissions.status;

    if (finalStatus !== 'granted') {
      const request = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowSound: true,
          allowBadge: true,
        },
      });
      finalStatus = request.status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    return tokenResult.data || null;
  } catch {
    return null;
  }
}

export function addNotificationListeners(
  onReceive: (notification: Notifications.Notification) => void,
  onResponse: (response: Notifications.NotificationResponse) => void
): () => void {
  const receivedSub = Notifications.addNotificationReceivedListener(onReceive);
  const responseSub = Notifications.addNotificationResponseReceivedListener(onResponse);

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}

export async function sendTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'TradeAid Alert',
      body: 'Push notifications with sound are active.',
      sound: 'default',
    },
    trigger: null,
  });
}
