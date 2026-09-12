export type SoundFluxState = 'idle' | 'listening' | 'thinking' | 'speaking';
export interface SoundFluxOptions {
  state?: SoundFluxState;
  /** Normalized audio level from 0 to 1. Defaults to silence (0). */
  level?: number;
  /** 0 = round; 0.625 = chosen middle; 1 = earlier strong wobble. */
  wobble?: number;
  paused?: boolean;
  /** Component width in pixels; shrinks to fit its parent. */
  size?: number;
  showBrand?: boolean;
  showStatus?: boolean;
  labels?: Partial<Record<SoundFluxState, string>>;
}
export interface SoundFluxController {
  readonly element: HTMLDivElement;
  setState(state: SoundFluxState): void;
  setLevel(level: number): void;
  setWobble(wobble: number): void;
  setPaused(paused: boolean): void;
  setTextVisibility(options: {showBrand?: boolean; showStatus?: boolean}): void;
  destroy(): void;
}
export function createSoundFlux(container: HTMLElement, options?: SoundFluxOptions): SoundFluxController;
