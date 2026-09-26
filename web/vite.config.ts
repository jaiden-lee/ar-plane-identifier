import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Allow ngrok tunnels to reach the dev server.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    // Allow importing ../shared/fixtures.
    fs: { allow: ['..'] },
    // One tunnel for everything: the phone only ever talks to this server.
    proxy: {
      '/api/flights': 'http://127.0.0.1:8001',
      '/api/voice': 'http://127.0.0.1:8002',
    },
  },
});
