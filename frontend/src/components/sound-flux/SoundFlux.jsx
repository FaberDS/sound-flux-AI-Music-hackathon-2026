'use client';
import {useEffect, useRef} from 'react';
import {createSoundFlux} from './sound-flux.js';

export function SoundFlux({state = 'idle', level = 0, wobble = .625, paused = false, size = 320, showBrand = true, showStatus = true, className, style}) {
  const container = useRef(null);
  const api = useRef(null);
  useEffect(() => {
    const instance = createSoundFlux(container.current, {size});
    api.current = instance;
    return () => {instance.destroy();api.current = null;};
  }, [size]);
  useEffect(() => {api.current?.setState(state);}, [state, size]);
  useEffect(() => {api.current?.setLevel(level);}, [level, size]);
  useEffect(() => {api.current?.setWobble(wobble);}, [wobble, size]);
  useEffect(() => {api.current?.setPaused(paused);}, [paused, size]);
  useEffect(() => {api.current?.setTextVisibility({showBrand, showStatus});}, [showBrand, showStatus, size]);
  return <div ref={container} className={className} style={style} />;
}
export default SoundFlux;
