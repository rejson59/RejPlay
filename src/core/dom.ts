import { clamp } from './random';

/** Minimalny, ale wygodny DOM builder. Zero zależności, zero innerHTML dla danych. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | number | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') {
      for (const [d, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined && v !== null) node.dataset[d] = String(v);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'value') (node as HTMLInputElement).value = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Brak elementu: ${selector}`);
  return found;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function toast(host: HTMLElement, message: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  const node = el('div', { class: `toast toast--${kind}`, role: 'status', text: message });
  host.append(node);
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 320);
  }, 3200);
  while (host.children.length > 3) host.firstElementChild?.remove();
}

export function bar(value: number, max = 1, color = ''): HTMLElement {
  const pct = clamp(max > 0 ? value / max : 0, 0, 1) * 100;
  return el('div', { class: 'meter' },
    el('i', { style: { width: `${pct}%`, ...(color ? { background: color } : {}) } }));
}

export function fmtClock(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes)) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
