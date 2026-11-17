import { useCallback, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Check, ChevronDown, Eye, EyeOff, Moon, Sun, X } from 'lucide-react';
import { useT } from './i18n';

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const { t } = useT();
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="overlay"/>
      <Dialog.Content className={`modal ${wide ? 'wide' : ''}`} aria-describedby={undefined}>
        <div className="modal-heading">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close asChild><button className="icon-button" aria-label={t.close}><X size={18}/></button></Dialog.Close>
        </div>
        <div className="modal-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function SelectField<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string;
}) {
  return <Select.Root value={value} onValueChange={v => onChange(v as T)}>
    <Select.Trigger className="select-trigger" aria-label={label}>
      <Select.Value/><Select.Icon><ChevronDown size={15}/></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="select-content" position="popper" sideOffset={4}>
        <Select.Viewport>
          {options.map(([v, text]) => <Select.Item key={v} value={v} className="select-item">
            <Select.ItemText>{text}</Select.ItemText>
            <Select.ItemIndicator className="select-check"><Check size={14}/></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

export function SwitchField({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const { t } = useT();
  return <label className="switch-row">
    <Switch.Root className="switch" checked={checked} onCheckedChange={onChange} dir={t.dir}><Switch.Thumb className="switch-thumb"/></Switch.Root>
    <span className="switch-text">{children}</span>
    <span className={`switch-state ${checked ? 'on' : ''}`}>{checked ? t.tg.on : t.tg.off}</span>
  </label>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string;
}) {
  const { t } = useT();
  return <ToggleGroup.Root className="segmented" type="single" value={value} aria-label={label} dir={t.dir}
    onValueChange={v => { if (v) onChange(v as T); }}>
    {options.map(([v, text]) => <ToggleGroup.Item key={v} value={v} className="segment">{text}</ToggleGroup.Item>)}
  </ToggleGroup.Root>;
}

export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{text}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>;
}

export const TooltipProvider = Tooltip.Provider;

type Theme = 'light' | 'dark';
const storedTheme = (): Theme => {
  try { const v = localStorage.getItem('kelvin-theme'); if (v === 'light' || v === 'dark') return v; } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#161b22');
    try { localStorage.setItem('kelvin-theme', theme); } catch {}
  }, [theme]);
  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const { t } = useT();
  const label = theme === 'dark' ? t.lightMode : t.darkMode;
  return <Tip text={label}><button className="icon-button" onClick={onToggle} aria-label={label}>{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}</button></Tip>;
}

// Private values (email, phone, IDs, network address, Wi-Fi details) stay blurred
// until their owner reveals them, and blur again by themselves after 30 seconds.
const REVEAL_MS = 30000;
function useReveal() {
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!shown) return; const id = setTimeout(() => setShown(false), REVEAL_MS); return () => clearTimeout(id); }, [shown]);
  return [shown, () => setShown(v => !v)] as const;
}

function RevealButton({ shown, toggle, label, size = 15 }: { shown: boolean; toggle: () => void; label: string; size?: number }) {
  const { t } = useT();
  return <button type="button" className="secret-toggle" onClick={toggle} aria-pressed={shown} aria-label={shown ? t.secret.hide(label) : t.secret.show(label)}
    title={shown ? t.secret.hide(label) : t.secret.show(label)}>{shown ? <EyeOff size={size}/> : <Eye size={size}/>}</button>;
}

/** Inline private text with an eye button. */
export function Secret({ children, label, dir = 'ltr' }: { children: ReactNode; label: string; dir?: 'ltr' | 'rtl' }) {
  const [shown, toggle] = useReveal();
  return <span className={`secret ${shown ? 'shown' : ''}`}>
    <span className="secret-value" dir={dir} aria-hidden={!shown}>{children}</span>
    <RevealButton shown={shown} toggle={toggle} label={label}/>
  </span>;
}

/** A text box whose value stays blurred until revealed; typing still works. */
export function SecretInput({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [shown, toggle] = useReveal();
  return <span className={`secret-input ${shown ? 'shown' : ''}`}>
    <input {...props}/>
    <RevealButton shown={shown} toggle={toggle} label={label} size={16}/>
  </span>;
}

/** A whole block (like generated code) under a blur, with one button in the middle. */
export function SecretBlock({ children, label }: { children: ReactNode; label: string }) {
  const { t } = useT();
  const [shown, toggle] = useReveal();
  return <div className={`secret-block ${shown ? 'shown' : ''}`}>
    <div className="secret-block-body" aria-hidden={!shown}>{children}</div>
    {shown
      ? <button type="button" className="button secret-block-hide" onClick={toggle}><EyeOff size={15}/>{t.secret.hide(label)}</button>
      : <button type="button" className="button secret-block-show" onClick={toggle}><Eye size={16}/>{t.secret.show(label)}</button>}
  </div>;
}
