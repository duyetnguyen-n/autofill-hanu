declare const __HANU_CLOUD_ORIGIN__: string | undefined;

export function cloudOrigin(): string {
  return typeof __HANU_CLOUD_ORIGIN__ === 'string' ? __HANU_CLOUD_ORIGIN__ : '';
}
export interface CoordinatorPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  error?: string;
  onMessage: { addListener(fn: (message: any) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}
export type Connector = () => CoordinatorPort | Promise<CoordinatorPort>;

export function websocketConnector(origin: string, Socket: typeof WebSocket = WebSocket): Connector {
  const url = new URL(origin);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Địa chỉ bộ điều phối không hợp lệ.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/extensions';
  return () => new Promise<CoordinatorPort>((resolve, reject) => {
    const socket = new Socket(url.toString());
    const messages: ((message: unknown) => void)[] = [], disconnects: (() => void)[] = [];
    let opened = false;
    const port: CoordinatorPort = {
      onMessage: { addListener: fn => messages.push(fn) }, onDisconnect: { addListener: fn => disconnects.push(fn) },
      postMessage(message) { if (socket.readyState !== 1) throw new Error('Website quản lý mất kết nối.'); socket.send(JSON.stringify(message)); },
      disconnect() { socket.close(1000, 'Client disconnect'); }
    };
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Website quản lý không phản hồi. Kiểm tra kết nối mạng.')); }, 8000);
    socket.onopen = () => { opened = true; clearTimeout(timeout); resolve(port); };
    socket.onmessage = event => {
      try { const message = JSON.parse(String(event.data)); for (const listener of messages) listener(message); }
      catch { port.error = 'Website gửi dữ liệu không hợp lệ.'; socket.close(1002, 'Invalid message'); }
    };
    socket.onerror = () => { port.error = 'Không kết nối được website quản lý. Kiểm tra mạng và địa chỉ server.'; if (!opened) { clearTimeout(timeout); reject(new Error(port.error)); } };
    socket.onclose = () => {
      clearTimeout(timeout);
      port.error ??= 'Mất kết nối website quản lý. Lượt đã tạm dừng để đối chiếu.';
      if (!opened) reject(new Error(port.error)); else for (const listener of disconnects) listener();
    };
  });
}
