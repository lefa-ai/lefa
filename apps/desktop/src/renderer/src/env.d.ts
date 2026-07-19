/// <reference types="vite/client" />

import type { LefaApi } from '../../shared/api'

declare global {
  interface Window {
    lefa: LefaApi
  }
}
