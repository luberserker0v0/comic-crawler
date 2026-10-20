import { useState, useEffect, useCallback, useRef } from 'react';

export function useWebSocket(url: string, onMessage?: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => connectSocket(url, setConnected, setWs, onMessageRef), [url]);
  const subscribe = useCallback((event: string) => sendSubscription(ws, 'subscribe', event), [ws]);
  const unsubscribe = useCallback((event: string) => sendSubscription(ws, 'unsubscribe', event), [ws]);
  return { connected, subscribe, unsubscribe };
}

function connectSocket(
  url: string,
  setConnected: (value: boolean) => void,
  setWs: (value: WebSocket | null) => void,
  onMessageRef: React.MutableRefObject<((data: any) => void) | undefined>
): () => void {
  const socket = new WebSocket(url);
  socket.onopen = () => { setConnected(true); setWs(socket); };
  socket.onclose = () => { setConnected(false); setWs(null); };
  socket.onmessage = (event) => handleSocketMessage(event, onMessageRef.current);
  return () => socket.close();
}

function handleSocketMessage(event: MessageEvent, onMessage?: (data: any) => void): void {
  try {
    onMessage?.(JSON.parse(event.data));
  } catch {
    console.error('Invalid WebSocket message:', event.data);
  }
}

function sendSubscription(ws: WebSocket | null, type: 'subscribe' | 'unsubscribe', event: string): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, event }));
}
