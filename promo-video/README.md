# Kelvin — cinematic promo video

An 80-second, 1920×1080, 30 fps promo for Kelvin, made with [Remotion](https://www.remotion.dev/) (React) and rendered to H.264 + AAC by Remotion's bundled FFmpeg.

- **Real app only:** every app screen in the film is a capture of the running app (Playwright), in `public/frames/`. The readings are sample data, and the film says so.
- **Scenes** (`src/scene.js`): the hook, the technology, the real dashboard in 3D (WebGL), monitoring and the Telegram alert (its real text), and the brand reveal.
- **Original score** (`src/score.js`): synthesised with the Web Audio API, no samples or licensed music; rendered to `public/score.wav` by `scripts/make-score.cjs`.

```
npm install
node scripts/make-score.cjs   # once, or after changing the score
npm run studio                # preview in the browser
npm run render                # → out/kelvin-promo-1080p.mp4
```

Remotion is free for individuals and small teams; see its license for company use.

## The launch film (2:49)

Composition `KelvinLaunch`: the cinematic intro, then a product-launch walkthrough of the real app on a 120 BPM grid — every shot a whole number of bars, so cuts, zooms, notes and music line up.

- `src/launch/edit.mjs` — the shot list, cut between markers of the recording (`public/rec/`, made by a Playwright script; not in Git — 475 MB).
- `src/launch/Launch.jsx` — footage, camera, spotlights, chapter cards, Excel sheets, emails, phone, tech cards.
- `src/launch/launch-score.js` — the original score, built from the same shot list.

```
npm run launch:score    # → public/launch.wav
npm run launch:render   # → out/kelvin-launch-1080p.mp4
```
