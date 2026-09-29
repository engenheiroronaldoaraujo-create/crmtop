import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Identificador do build, injetado no bundle e exibido no rodapé do app.
// Existe para resolver uma classe de bug que já custou várias rodadas: com o
// PWA servindo do cache do service worker, é impossível distinguir "o código
// novo não fez o que deveria" de "o navegador nunca recebeu o código novo".
// Ver a versão na tela elimina a segunda hipótese em um segundo.
function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
    if (sha) return sha
  } catch {
    // sem git (build local ou diretório desempacotado)
  }
  // Fallback com timestamp: garante que cada build seja distinto mesmo sem
  // git, para o rodapé ainda servir ao diagnóstico de cache.
  return new Date().toISOString().slice(2, 16).replace(/[-:T]/g, "")
}

const BUILD_ID = buildId()

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "CRM WhatsApp",
        short_name: "CRM",
        description: "CRM para atendimento via WhatsApp",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0b1220",
        theme_color: "#0b1220",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Sem cleanupOutdatedCaches, o cache de versões anteriores continua
        // sendo servido e o usuário fica preso num bundle obsoleto sem aviso.
        // Foi o que aconteceu com a gravação de áudio: o sintoma era
        // idêntico ao de um bug de código, mas a causa era cache.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "supabase-storage",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-avatar",
          ],
        },
      },
    },
  },
})
