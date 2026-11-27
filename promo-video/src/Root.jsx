import { Composition } from 'remotion';
import { Promo } from './Promo.jsx';
import { Launch, EDIT } from './launch/Launch.jsx';
import { Keynote, EDIT as KEDIT } from './keynote/Keynote.jsx';
import { DURATION, RATE, WIDTH, HEIGHT } from './scene.js';

export const Root = () => (
  <>
    <Composition id="KelvinPromo" component={Promo} durationInFrames={DURATION * RATE} fps={RATE} width={WIDTH} height={HEIGHT} />
    <Composition id="KelvinKeynote" component={Keynote} durationInFrames={KEDIT.frames} fps={30} width={1920} height={1080} />
    <Composition id="KelvinLaunch" component={Launch} durationInFrames={EDIT.frames} fps={30} width={1920} height={1080} />
  </>
);
