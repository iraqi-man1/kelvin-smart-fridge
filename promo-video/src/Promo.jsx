import { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { drawFrame, setup } from './scene.js';

// Each frame is drawn by scene.js (2D canvas + WebGL) and copied onto this canvas.
export const Promo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef(null);
  const [handle] = useState(() => delayRender('Loading the app captures and fonts'));
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => { setup(staticFile).then(() => { setReady(true); continueRender(handle); }); }, [handle]);
  useLayoutEffect(() => {
    if (!ready) return;
    ref.current.getContext('2d').drawImage(drawFrame(frame / fps), 0, 0);
  }, [frame, fps, ready]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <canvas ref={ref} width={1920} height={1080} />
      <Audio src={staticFile('score.wav')} />
    </AbsoluteFill>
  );
};
