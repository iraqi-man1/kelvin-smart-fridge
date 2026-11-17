import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useT } from './i18n';

/** Six boxes for a 6-digit code: typing moves on, Backspace moves back, pasting fills all. */
export function OtpInput({ value, onChange, onComplete, disabled, autoFocus }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; autoFocus?: boolean;
}) {
  const { t } = useT();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { if (autoFocus) setTimeout(() => boxes.current[0]?.focus(), 60); }, [autoFocus]);

  function set(next: string, focus: number) {
    const clean = next.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    boxes.current[Math.min(focus, 5)]?.focus();
    if (clean.length === 6) onComplete?.(clean);
  }
  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[i] && i > 0) { e.preventDefault(); set(value.slice(0, i - 1) + value.slice(i), i - 1); }
    if (e.key === 'ArrowLeft') boxes.current[Math.max(0, i - 1)]?.focus();
    if (e.key === 'ArrowRight') boxes.current[Math.min(5, i + 1)]?.focus();
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!digits) return;
    e.preventDefault();
    set(digits, digits.length);
  }

  return <div className="otp-boxes" dir="ltr" role="group" aria-label={t.otp.codeLabel}>
    {Array.from({ length: 6 }, (_, i) => <input key={i} ref={el => { boxes.current[i] = el; }}
      inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6} disabled={disabled}
      aria-label={`${t.otp.digit} ${i + 1}`} value={value[i] ?? ''} className={i === 2 ? 'gap-after' : ''}
      onChange={e => { const d = e.target.value.replace(/\D/g, ''); if (d.length > 1) set(d, d.length); else set(value.slice(0, i) + d + value.slice(i + 1), d ? i + 1 : i); }}
      onKeyDown={e => onKey(i, e)} onPaste={onPaste} onFocus={e => e.target.select()}/>)}
  </div>;
}

/** "Resend code" with its one-minute wait shown as a countdown. */
export function ResendButton({ seconds, onResend, disabled }: { seconds: number; onResend: () => void; disabled?: boolean }) {
  const { t } = useT();
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(id); }, [left]);
  return <button type="button" className="text-button" disabled={disabled || left > 0} onClick={onResend}>
    {left > 0 ? t.otp.resendIn(left) : t.otp.resend}
  </button>;
}
