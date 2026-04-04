import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'pwa-192x192.svg',
        'pwa-512x512.svg',
        'pwa-maskable-512x512.svg',
        'apple-touch-icon-180x180.svg',
      ],
      manifest: {
        name: 'GAINS',
        short_name: 'GAINS',
        description: 'AI-powered fitness coaching, training programs, and nutrition tracking',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-maskable-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache all built assets (JS, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],

        // Runtime caching strategies
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase REST API (data queries) - network first, fall back to cache
            urlPattern: /^https:\/\/hsiqzmbfulmfxbvbsdwz\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Supabase Auth - network only (never cache auth)
            urlPattern: /^https:\/\/hsiqzmbfulmfxbvbsdwz\.supabase\.co\/auth\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Supabase Edge Functions - network only (AI responses, mutations)
            urlPattern: /^https:\/\/hsiqzmbfulmfxbvbsdwz\.supabase\.co\/functions\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Static images in public/images
            urlPattern: /\/images\/.+\.(png|jpg|jpeg|webp|svg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-images',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
