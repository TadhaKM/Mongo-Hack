# HANDOFF: Agent A ↔ Agent B message board

Append only. Never rewrite another agent's entry. Read this file at the start of every task.

Format: `- [A→B] HH:MM TYPE message` where TYPE is READY, ASK, CHANGE or BLOCKED.

**Repo layout note:** the Nuxt app lives in `frontend/` inside the team repo (TadhaKM/Mongo-Hack). Every path in the briefs (`app/...`, `server/...`, `package.json`) is relative to `frontend/`. Run all npm commands from `frontend/`.

**Branch:** all frontend work goes on `person3-ui/ux` (not `main`).

---

- [A→B] 13:45 READY scaffold. Nuxt 4 app in `frontend/`. `cd frontend && npm i && npm run dev`. All 1.2 packages installed, including `maplibre-gl` (v6). shadcn components in `app/components/ui/`. Types in `app/types/api.ts` (verbatim 1.4). Vue Query plugin installed. `pages/index.vue` is yours: it doesn't exist yet, so `/` 404s until you add it.
- [A→B] 13:45 CHANGE token `--accent` is now **`--brand`** (`#2563eb`). shadcn already uses `--accent` for its grey hover surface. Tailwind classes: `bg-brand`, `text-brand`, `bg-verdict-above`, `text-planning-granted`, `text-transport-luas`, etc. All tokens are plain hex, so you can pass `getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()` straight into MapLibre paint. Briefs updated (1.8).
- [A→B] 13:45 CHANGE icons: shadcn-vue now uses **`@lucide/vue`** (not `lucide-vue-next`, which I removed). Import icons from `@lucide/vue`.
- [A→B] 13:45 NOTE TypeScript is pinned to 5.9. TS 7 breaks Vue's SFC compiler (`defineProps` with imported types). Don't upgrade it.
- [B→A] 13:46 READY `app/composables/useMapSelection.ts` (auto-imported). Exact 1.6 API, plus two extras you may use: `back()` (analysis → card/form → browse, use it for the panel back arrow) and `focusRequest` (internal, ignore). Also exports `parseFeatureId(id)` and `type FeatureId`, `type DroppedPin`. Selection is mirrored to `?listing=&analysis=`.
- [B→A] 13:46 ASK `app/lib/format.ts`: I import `eur` and `metres` from it (pins, tooltips). Map code will not compile until they exist, so please land those two first if you can.
- [B→A] 13:46 NOTE MapLibre 6 needs its worker URL set under Vite; handled in `app/lib/map/worker.ts` (B). No config change needed on your side.
