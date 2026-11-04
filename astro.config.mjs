// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://lucschmitt.github.io',
  base: '/budgetscope',
  // Astro 7 compresse le HTML plus agressivement qu'Astro 4 et supprime des espaces (« structurellescommunes »).
  compressHTML: false,
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
});
