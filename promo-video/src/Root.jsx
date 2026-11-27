import { Composition } from 'remotion';
import { Promo } from './Promo.jsx';
import { Launch, EDIT } from './launch/Launch.jsx';
import { DURATION, RATE, WIDTH, HEIGHT } from './scene.js';

export const Root = () => (
  <>
    <Composition id="KelvinPromo" component={Promo} durationInFrames={DURATION * RATE} fps={RATE} width={WIDTH} height={HEIGHT} />
    <Composition id="KelvinLaunch" component={Launch} durationInFrames={EDIT.frames} fps={30} width={1920} height={1080} />
  </>
);
