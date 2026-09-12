import type {CSSProperties, ReactElement} from 'react';
import type {SoundFluxOptions} from './sound-flux.js';
export interface SoundFluxProps extends Omit<SoundFluxOptions, 'labels'> {
  className?: string;
  style?: CSSProperties;
}
export function SoundFlux(props: SoundFluxProps): ReactElement;
export default SoundFlux;
