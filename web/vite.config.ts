import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Allow ngrok tunnels to reach the dev server.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    // One tunnel for everything: the phone only ever talks to this server.
    proxy: {
      '/api/flights': 'http://localhost:8001',
      '/api/voice': 'http://localhost:8002',
    },
  },
});
