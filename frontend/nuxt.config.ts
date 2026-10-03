// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['shadcn-nuxt'],
  css: ['~/assets/css/main.css'],
  // Auto-import the data layer (Agent A) alongside top-level composables.
  imports: { dirs: ['composables/api'] },
  vite: {
    plugins: [tailwindcss()],
  },
  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },
  runtimeConfig: {
    public: {
      apiBase: '/api',
    },
  },
  app: {
    head: {
      title: 'RentCheck AI',
      meta: [{ name: 'description', content: 'Know before you rent. Check any Irish rental against real market, transport, census and planning data.' }],
    },
  },
  typescript: { strict: true },
})
