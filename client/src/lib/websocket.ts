// Singleton WebSocket connection manager
class WebSocketManager {
  private static instance: WebSocketManager;
  private socket: WebSocket | null = null;
  private retryCount = 0;
  private maxRetryCount = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    this.connect();
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
      // Use secure WebSocket protocol if the page is served over HTTPS
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('Connecting to WebSocket:', wsUrl);
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('WebSocket connected');
        // Reset retry count on successful connection
        this.retryCount = 0;
        // Send initial authentication message
        this.send({ type: 'auth' });
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);

        // Clear any existing reconnection timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }

        // Attempt to reconnect if we haven't exceeded max retries
        if (this.retryCount < this.maxRetryCount) {
          const backoffTime = this.getBackoffTime();
          console.log(`Attempting reconnect in ${backoffTime}ms (attempt ${this.retryCount + 1}/${this.maxRetryCount})`);

          this.reconnectTimeout = setTimeout(() => {
            this.retryCount++;
            this.connect();
          }, backoffTime);
        } else {
          console.error('Max reconnection attempts reached');
        }
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);

          // Handle different message types
          switch (data.type) {
            case 'auth_success':
              console.log('Authentication successful');
              break;
            case 'auth_error':
              console.error('Authentication failed:', data.error);
              this.socket?.close();
              break;
            default:
              console.log('Unhandled message type:', data.type);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }

  public send(message: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected, message not sent:', message);
    }
  }

  public disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.socket) {
      this.socket.close();
    }
  }
}

// Export a singleton instance
export const webSocket = WebSocketManager.getInstance();