/// <reference types="vite/client" />

interface Window {
  advizeMeDesktop?: {
    notify: (title: string, body: string) => Promise<{ ok: boolean }>;
    getVersion: () => Promise<string>;
  };
}
