import { setJapaneseText } from "./japanese-text";
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
export function jp<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  cls?: string,
) {
  const n = el(tag, undefined, cls);
  setJapaneseText(n, text);
  return n;
}
export function button(label: string, fn: () => void, cls = "primary") {
  const b = el("button", label, cls);
  b.type = "button";
  b.onclick = fn;
  return b;
}
export function field(
  label: string,
  id: string,
  maxLength: number,
  placeholder = "",
) {
  const wrap = el("label", undefined, "field");
  wrap.htmlFor = id;
  wrap.append(el("span", label));
  const input = el("input");
  input.id = id;
  input.maxLength = maxLength;
  input.autocomplete = "off";
  input.placeholder = placeholder;
  wrap.append(input);
  return { wrap, input };
}
