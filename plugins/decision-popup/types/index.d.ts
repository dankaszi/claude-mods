// Az eszköztár (tool-hub) kérése: a kapcsoló gomb ezt írja, a mod a state.set hookjában veszi át.
export type HubRequest = { tool: string; on: boolean; n: number }

declare module 'claude-code' {
  interface PluginState {
    'tool-hub': { request: HubRequest | null }
    'decision-popup': { isOn: boolean }
    // Az őr-modok éppen nyitott kérdése (csak a mod írhatja, a modell nem).
    'supabase-guard': { asking: string | null }
    'public-repo-guard': { asking: string | null }
  }
}
