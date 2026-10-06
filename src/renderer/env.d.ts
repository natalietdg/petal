import type { PastelApi } from '../preload';
import type { DebugHandle } from './app';

declare global {
  interface Window {
    pastel: PastelApi;
    PastelTerm: DebugHandle;
  }
}
