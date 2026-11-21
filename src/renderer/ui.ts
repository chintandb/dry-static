/** Tiny DOM helpers: no framework, no build-time magic. */

type Attrs = Record<string, string | number | boolean | ((ev: Event) => void) | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value as EventListener);
    else if (key === 'class') node.className = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' = 'primary'): HTMLButtonElement {
  return el('button', { class: `btn btn-${kind}`, onclick: onClick, type: 'button' }, label);
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function chip(text: string, tone: 'ok' | 'warn' | 'bad' | 'idle'): HTMLElement {
  return el('span', { class: `chip chip-${tone}` }, text);
}
