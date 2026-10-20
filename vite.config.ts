import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  // uploads are served by `PORT=3311 npm start`; the dev server forwards to it
  server: { proxy: { '/api': 'http://localhost:3311', '/m/': 'http://localhost:3311' } },
  define: { __VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) },
})
