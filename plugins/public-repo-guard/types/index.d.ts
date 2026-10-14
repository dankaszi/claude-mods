// Az eszköztár (tool-hub) kérése: a kapcsoló gomb ezt írja, a mod a state.set hookjában veszi át.
export type HubRequest = { tool: string; on: boolean; n: number }

declare module 'claude-code' {
  interface PluginState {
    'tool-hub': { request: HubRequest | null }
    // A guard saját, éppen nyitott kérdése: a decision-popup ebből tudja, hogy valóban az őr kérdez (a modell ezt nem írhatja).
    'public-repo-guard': { isOn: boolean; asking: string | null }
  }
}
