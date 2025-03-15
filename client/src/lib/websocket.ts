// Singleton WebSocket connection manager
class WebSocketManager {
  private static instance: WebSocketManager;
  private socket: WebSocket | null = null;
  private retryCount = 0;
  private maxRetryCount = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    // Don't connect immediately, wait for the first usage
  }

  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  private getBackoffTime(): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    return Math.min(1000 * Math.pow(2, this.retryCount), 16000);
  }

  private connect() {
    try {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }

      // Use appropriate WebSocket protocol based on current environment
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('WebSocket: Attempting to connect to:', wsUrl);
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('WebSocket: Connected successfully');
        this.retryCount = 0;
        // Send initial authentication message
        this.send({ type: 'auth' });
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket: Connection closed -', 'Code:', event.code, 'Reason:', event.reason);

        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }

        if (this.retryCount < this.maxRetryCount) {
          const backoffTime = this.getBackoffTime();
          console.log(`WebSocket: Attempting reconnect in ${backoffTime}ms (attempt ${this.retryCount + 1}/${this.maxRetryCount})`);

          this.reconnectTimeout = setTimeout(() => {
            this.retryCount++;
            this.connect();
          }, backoffTime);
        } else {
          console.error('WebSocket: Max reconnection attempts reached');
        }
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket: Connection error occurred:', error);
        console.log('WebSocket: Current connection state:', this.socket?.readyState);
        console.log('WebSocket: Using URL:', wsUrl);
        console.log('WebSocket: Protocol:', protocol);
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket: Received message:', data);

          switch (data.type) {
            case 'auth_success':
              console.log('WebSocket: Authentication successful');
              break;
            case 'auth_error':
              console.error('WebSocket: Authentication failed:', data.error);
              // Trigger a reconnect after auth error
              setTimeout(() => this.reconnect(), 1000);
              break;
            case 'error':
              console.error('WebSocket: Server reported error:', data.message);
              break;
            case 'pong':
              console.log('WebSocket: Received pong response');
              break;
            default:
              console.log('WebSocket: Unhandled message type:', data.type);
          }
        } catch (error) {
          console.error('WebSocket: Error parsing message:', error);
        }
      };
    } catch (error) {
      console.error('WebSocket: Error creating connection:', error);
    }
  }

  public send(message: any) {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      this.connect();
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
        console.log('WebSocket: Message sent successfully:', message);
      } catch (error) {
        console.error('WebSocket: Error sending message:', error);
      }
    } else {
      console.warn('WebSocket: Cannot send message - connection not open. State:', this.socket?.readyState);
    }
  }

  public disconnect() {
    console.log('WebSocket: Initiating disconnect');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public reconnect(): void {
    console.log('WebSocket: Forcing reconnection');
    this.retryCount = 0;
    this.connect();
  }
}

// Export a singleton instance
export const webSocket = WebSocketManager.getInstance();