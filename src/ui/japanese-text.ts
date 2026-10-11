import { loadDefaultJapaneseParser } from "budoux";
const parser = loadDefaultJapaneseParser();
export function setJapaneseText(element: HTMLElement, text: string) {
  element.classList.add("japanese-text");
  element.replaceChildren();
  // Text nodes preserve the original copyable text; wbr adds only break opportunities.
  parser.parse(text).forEach((chunk, index) => {
    if (index) element.append(document.createElement("wbr"));
    element.append(document.createTextNode(chunk));
  });
  if (/^H[1-6]$/.test(element.tagName))
    element.setAttribute("aria-label", text);
}
