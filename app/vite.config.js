import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Serve the existing repo data (Sources/, Assets/) as static files during dev and build.
// We do this by symlinking them into app/public/.
export default defineConfig({
  plugins: [svelte()],
  base: './',
})
