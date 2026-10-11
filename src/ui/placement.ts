import { TIERS, type Placement, type Word, type Tier } from "../domain/types";
import { el, jp } from "./dom";
export function createPlacementEditor(
  container: HTMLElement,
  candidates: Word[],
  value: Placement,
  onChange: (p: Placement) => void,
) {
  let current = { ...value };
  let selected: string | null = null;
  const heading = jp(
    "p",
    "ワードを選んで段をタップ。下の選択欄やドラッグでも配置できます。",
    "hint",
  );
  const bank = el("div", undefined, "word-bank");
  const board = el("div", undefined, "tier-board");
  const controls = el("div", undefined, "placement-controls");
  const chips = new Map<string, HTMLButtonElement>();
  const selects = new Map<string, HTMLSelectElement>();
  const rows = new Map<Tier, HTMLElement>();
  const move = (id: string, tier: Tier) => {
    current = { ...current, [id]: tier };
    selected = null;
    paint();
    onChange({ ...current });
  };
  const paint = () => {
    for (const w of candidates) {
      const chip = chips.get(w.id)!;
      chip.classList.toggle("selected", selected === w.id);
      chip.setAttribute("aria-pressed", String(selected === w.id));
      (rows.get(current[w.id]) ?? bank).append(chip);
      selects.get(w.id)!.value = current[w.id] ?? "";
    }
  };
  for (const tier of TIERS) {
    const row = el("div", undefined, `tier-row tier-${tier}`);
    const target = el("button", tier, "tier-label");
    target.type = "button";
    target.setAttribute("aria-label", `${tier}に配置`);
    target.onclick = () => {
      if (selected) move(selected, tier);
    };
    const area = el("div", undefined, "tier-items");
    row.append(target, area);
    row.ondragover = (e) => {
      e.preventDefault();
    };
    row.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("text/plain");
      if (id && chips.has(id)) move(id, tier);
    };
    rows.set(tier, area);
    board.append(row);
  }
  for (const w of candidates) {
    const chip = el("button", undefined, "word-chip");
    chip.type = "button";
    chip.draggable = true;
    jpText(chip, w.text);
    chip.onclick = () => {
      selected = selected === w.id ? null : w.id;
      paint();
    };
    chip.ondragstart = (e) => {
      e.dataTransfer?.setData("text/plain", w.id);
    };
    chips.set(w.id, chip);
    const label = el("label", undefined, "placement-field");
    label.append(jp("span", w.text));
    const select = el("select", undefined, "placement-select");
    select.setAttribute("aria-label", `${w.text}の段`);
    const empty = el("option", "未配置");
    empty.value = "";
    select.append(empty);
    for (const tier of TIERS) {
      const o = el("option", tier);
      o.value = tier;
      select.append(o);
    }
    select.onchange = () => {
      if (select.value) move(w.id, select.value as Tier);
      else {
        delete current[w.id];
        paint();
        onChange({ ...current });
      }
    };
    label.append(select);
    selects.set(w.id, select);
    controls.append(label);
  }
  container.append(heading, bank, board, controls);
  paint();
  return {
    update(p: Placement) {
      current = { ...p };
      paint();
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
function jpText(n: HTMLElement, text: string) {
  const safe = jp("span", text);
  n.append(safe);
}
