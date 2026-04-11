// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://lucschmitt.github.io',
  base: '/budgetscope',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
});
