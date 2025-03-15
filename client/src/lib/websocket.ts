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

      // Always use ws:// in development for now
      const wsUrl = `ws://${window.location.host}/ws`;

      console.log('WebSocket: Attempting to connect to:', wsUrl);
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('WebSocket: Connected successfully');
        // Reset retry count on successful connection
        this.retryCount = 0;
        // Send initial authentication message
        this.send({ type: 'auth' });
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket: Connection closed -', 'Code:', event.code, 'Reason:', event.reason);

        // Clear any existing reconnection timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }

        // Attempt to reconnect if we haven't exceeded max retries
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
        // Log additional connection details for debugging
        console.log('WebSocket: Current connection state:', this.socket?.readyState);
        console.log('WebSocket: Using URL:', wsUrl);
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket: Received message:', data);

          // Handle different message types
          switch (data.type) {
            case 'auth_success':
              console.log('WebSocket: Authentication successful');
              break;
            case 'auth_error':
              console.error('WebSocket: Authentication failed:', data.error);
              // Don't close the socket here, let the reconnection logic handle it
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
    // Connect if not already connected
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

  // Add a method to check connection status
  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  // Add a method to force a new connection
  public reconnect(): void {
    this.retryCount = 0;
    this.connect();
  }
}

// Export a singleton instance
export const webSocket = WebSocketManager.getInstance();