import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const WS_URL = (Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000').replace('http', 'ws');

type MessageHandler = (data: any) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: any) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private messageHandlers: MessageHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private isConnecting = false;
  private shouldReconnect = true;
  private endpoint: string;

  constructor(endpoint: '/ws' | '/ws/alerts' = '/ws') {
    this.endpoint = endpoint;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      const token = await SecureStore.getItemAsync('authToken');
      const wsUrl = token 
        ? `${WS_URL}${this.endpoint}?token=${token}`
        : `${WS_URL}${this.endpoint}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[WebSocket] Connected to ${this.endpoint}`);
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.connectionHandlers.forEach(handler => handler());
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log(`[WebSocket] Message received:`, data);
          this.messageHandlers.forEach(handler => handler(data));
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        this.errorHandlers.forEach(handler => handler(error));
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Connection closed');
        this.isConnecting = false;
        
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`[WebSocket] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          setTimeout(() => this.connect(), this.reconnectDelay);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.isConnecting = false;
      this.errorHandlers.forEach(handler => handler(error));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send message - connection not open');
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.push(handler);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
    };
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instances
export const mainWebSocket = new WebSocketService('/ws');
export const alertsWebSocket = new WebSocketService('/ws/alerts');

// Hook for easy usage in React components
export function useWebSocket(endpoint: '/ws' | '/ws/alerts' = '/ws') {
  const ws = endpoint === '/ws' ? mainWebSocket : alertsWebSocket;
  return ws;
}
