import { Composition } from 'remotion';
import { Promo } from './Promo.jsx';
import { DURATION, RATE, WIDTH, HEIGHT } from './scene.js';

export const Root = () => (
  <Composition id="KelvinPromo" component={Promo} durationInFrames={DURATION * RATE} fps={RATE} width={WIDTH} height={HEIGHT} />
);
