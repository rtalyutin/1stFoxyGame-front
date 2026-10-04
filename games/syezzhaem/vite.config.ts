import { defineConfig } from 'vite';
export default defineConfig({ base: './', define: { __SYEZZHAEM_BUILD_ID__: JSON.stringify(process.env.BUILD_ID || 'r1-intro-001') }, server: { proxy: { '/api/syezzhaem': 'http://127.0.0.1:8091' } }, build: { target: 'es2022' } });
