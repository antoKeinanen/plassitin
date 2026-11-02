import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), nitro({
    traceDeps: ['highs*'],
    vercel: { functions: { maxDuration: 60 } },
    hooks: {
      async compiled(nitro) {
        const workers = resolve(nitro.options.output.serverDir, 'workers')
        await mkdir(workers, { recursive: true })
        await cp(resolve('workers/optimizer.mjs'), resolve(workers, 'optimizer.mjs'))
      },
    },
  }), viteReact()],
})

export default config
