import { useState, useEffect, useCallback, useRef } from 'react';

export function useWebSocket(url: string, onMessage?: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const socket = new WebSocket(url);

    socket.onopen = () => {
      setConnected(true);
      setWs(socket);
    };

    socket.onclose = () => {
      setConnected(false);
      setWs(null);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(data);
      } catch {
        console.error('Invalid WebSocket message:', event.data);
      }
    };

    return () => {
      socket.close();
    };
  }, [url]);

  const subscribe = useCallback((event: string) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', event }));
    }
  }, [ws]);

  const unsubscribe = useCallback((event: string) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', event }));
    }
  }, [ws]);

  return { connected, subscribe, unsubscribe };
}
