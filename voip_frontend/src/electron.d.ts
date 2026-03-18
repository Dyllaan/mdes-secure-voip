export interface ElectronAPI {
  send: (channel: string, data?: unknown) => void
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  invoke: (channel: string, data?: unknown) => Promise<unknown>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}