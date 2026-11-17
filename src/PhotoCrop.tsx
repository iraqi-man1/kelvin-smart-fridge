import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from './i18n';
import { Modal } from './ui';

const VIEW = 280;      // size of the square frame on screen, in px
const OUT = 512;       // size of the saved photo, in px
const MAX_ZOOM = 4;

type Props = { file: File; onCancel: () => void; onSave: (photo: Blob) => void; busy: boolean };

/** Zoom, drag and rotate a photo inside a round frame, then save it as a square JPEG. */
export function PhotoCrop({ file, onCancel, onSave, busy }: Props) {
  const { t } = useT();
  const c = t.crop;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);              // 0, 90, 180 or 270
  const [pos, setPos] = useState({ x: 0, y: 0 });  // image centre, relative to the frame centre
  const drag = useRef<{ id: number; x: number; y: number; start: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    let live = true; // a cancelled load (its URL already revoked) must not report a broken photo
    i.onload = () => { if (live) { setImg(i); setFailed(false); } };
    i.onerror = () => { if (live) setFailed(true); };
    i.src = url;
    return () => { live = false; URL.revokeObjectURL(url); };
  }, [file]);

  // Width and height as seen on screen, after rotation.
  const turned = rot % 180 !== 0;
  const w = img ? (turned ? img.naturalHeight : img.naturalWidth) : 1;
  const h = img ? (turned ? img.naturalWidth : img.naturalHeight) : 1;
  const scale = VIEW / Math.min(w, h) * zoom;

  // Keep the photo covering the whole frame: no empty corners.
  const clamp = (p: { x: number; y: number }, s = scale) => {
    const mx = Math.max(0, (w * s - VIEW) / 2), my = Math.max(0, (h * s - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const setZoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    setPos(p => clamp(p, VIEW / Math.min(w, h) * next));
  };
  useEffect(() => { setPos(p => clamp(p)); }, [rot]); // eslint-disable-line react-hooks/exhaustive-deps

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: pos };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clamp({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }));
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => setZoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); setPos(p => clamp({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] })); }
    if (e.key === '+' || e.key === '=') setZoomTo(zoom * 1.1);
    if (e.key === '-') setZoomTo(zoom / 1.1);
  }

  async function save() {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext('2d')!;
    const k = OUT / VIEW;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(OUT / 2 + pos.x * k, OUT / 2 + pos.y * k);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(scale * k, scale * k);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    canvas.toBlob(b => b && onSave(b), 'image/jpeg', 0.9);
  }

  const reset = () => { setZoom(1); setRot(0); setPos({ x: 0, y: 0 }); };

  return <Modal title={c.title} onClose={onCancel}>
    {failed ? <p className="form-error">{t.auth.errors['bad-image']}</p> : <>
      <div className="crop-stage">
        <div className="crop-view" style={{ width: VIEW, height: VIEW }} tabIndex={0} role="application" aria-label={c.frame}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onWheel={onWheel} onKeyDown={onKey}>
          {img && <img src={img.src} alt="" draggable={false} style={{
            width: img.naturalWidth, height: img.naturalHeight,
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg) scale(${scale})`,
          }}/>}
          <span className="crop-ring" aria-hidden="true"/>
        </div>
      </div>
      <p className="hint crop-hint">{c.hint}</p>
      <div className="crop-controls">
        <button type="button" className="icon-button" onClick={() => setZoomTo(zoom / 1.2)} aria-label={c.zoomOut}><ZoomOut size={18}/></button>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => setZoomTo(+e.target.value)} aria-label={c.zoom} dir="ltr"/>
        <button type="button" className="icon-button" onClick={() => setZoomTo(zoom * 1.2)} aria-label={c.zoomIn}><ZoomIn size={18}/></button>
        <span className="crop-sep"/>
        <button type="button" className="icon-button" onClick={() => setRot(r => (r + 270) % 360)} aria-label={c.rotateLeft}><RotateCcw size={18}/></button>
        <button type="button" className="icon-button" onClick={() => setRot(r => (r + 90) % 360)} aria-label={c.rotateRight}><RotateCw size={18}/></button>
        <button type="button" className="text-button" onClick={reset}>{c.reset}</button>
      </div>
    </>}
    <div className="modal-actions">
      <button type="button" className="button primary" onClick={save} disabled={!img || busy}>{busy ? t.auth.working : c.save}</button>
      <button type="button" className="button ghost" onClick={onCancel}>{c.cancel}</button>
    </div>
  </Modal>;
}
