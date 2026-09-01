import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], publicDir: 'stateless_editor/static/stateless' });
