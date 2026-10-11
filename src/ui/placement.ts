import { TIERS, type Placement, type Word, type Tier } from "../domain/types";
import { el, jp } from "./dom";
export function createPlacementEditor(
  container: HTMLElement,
  candidates: Word[],
  value: Placement,
  onChange: (p: Placement) => void,
) {
  let current = { ...value };
  const bank = el("div", undefined, "word-bank");
  bank.setAttribute("aria-label", "未配置のワード");
  const board = el("div", undefined, "tier-board");
  const chips = new Map<string, HTMLButtonElement>();
  const rows = new Map<Tier, HTMLElement>();
  let ghost: HTMLElement | undefined;
  let touch:
    | {
        id: string;
        pointerId: number;
        x: number;
        y: number;
        currentY: number;
        active: boolean;
      }
    | undefined;
  let scrollFrame = 0;
  const cleanup = () => {
    cancelAnimationFrame(scrollFrame);
    ghost?.remove();
    ghost = undefined;
    touch = undefined;
    chips.forEach((c) => c.classList.remove("dragging"));
  };
  const scroll = () => {
    if (!touch?.active) return;
    const y = touch.currentY;
    const speed = y < 64 ? -12 : y > innerHeight - 64 ? 12 : 0;
    if (speed) window.scrollBy(0, speed);
    scrollFrame = requestAnimationFrame(scroll);
  };
  const paint = () => {
    for (const w of candidates)
      (rows.get(current[w.id]) ?? bank).append(chips.get(w.id)!);
  };
  const move = (id: string, tier?: Tier) => {
    if (tier) current = { ...current, [id]: tier };
    else {
      current = { ...current };
      delete current[id];
    }
    paint();
    onChange({ ...current });
  };
  const drop = (event: DragEvent, tier?: Tier) => {
    event.preventDefault();
    const id = event.dataTransfer?.getData("text/plain");
    if (id && chips.has(id)) move(id, tier);
  };
  bank.ondragover = (e) => e.preventDefault();
  bank.ondrop = (e) => drop(e);
  for (const tier of TIERS) {
    const row = el("div", undefined, `tier-row tier-${tier}`);
    row.dataset.tier = tier;
    row.append(el("span", tier, "tier-label"));
    const area = el("div", undefined, "tier-items");
    row.append(area);
    row.ondragover = (e) => {
      e.preventDefault();
    };
    row.ondrop = (e) => drop(e, tier);
    rows.set(tier, area);
    board.append(row);
  }
  for (const w of candidates) {
    const chip = el("button", undefined, "word-chip");
    chip.type = "button";
    chip.draggable = true;
    chip.setAttribute("aria-label", w.text);
    chip.append(jp("span", w.text));
    chip.ondragstart = (e) => {
      e.dataTransfer?.setData("text/plain", w.id);
      chip.classList.add("dragging");
    };
    chip.ondragend = () => chip.classList.remove("dragging");
    chip.onpointerdown = (e) => {
      if (e.pointerType === "mouse" || touch) return;
      touch = {
        id: w.id,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        currentY: e.clientY,
        active: false,
      };
      chip.setPointerCapture(e.pointerId);
    };
    chip.onpointermove = (e) => {
      if (!touch || touch.id !== w.id || touch.pointerId !== e.pointerId)
        return;
      touch.currentY = e.clientY;
      if (
        !touch.active &&
        Math.hypot(e.clientX - touch.x, e.clientY - touch.y) < 6
      )
        return;
      e.preventDefault();
      if (!touch.active) {
        touch.active = true;
        ghost = chip.cloneNode(true) as HTMLElement;
        ghost.classList.add("drag-ghost");
        ghost.removeAttribute("id");
        document.body.append(ghost);
        chip.classList.add("dragging");
        scrollFrame = requestAnimationFrame(scroll);
      }
      ghost!.style.left = `${e.clientX}px`;
      ghost!.style.top = `${e.clientY}px`;
    };
    const end = (e: PointerEvent, cancel = false) => {
      if (!touch || touch.id !== w.id || touch.pointerId !== e.pointerId)
        return;
      const active = touch.active;
      cleanup();
      if (active && !cancel) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const tier = target?.closest<HTMLElement>(".tier-row")?.dataset.tier as
          Tier | undefined;
        if (tier && TIERS.includes(tier)) move(w.id, tier);
        else if (target?.closest(".word-bank")) move(w.id);
      }
    };
    chip.onpointerup = (e) => end(e);
    chip.onpointercancel = (e) => end(e, true);
    chip.onlostpointercapture = (e) => end(e, true);
    chips.set(w.id, chip);
  }
  container.append(
    jp("p", "ワードをドラッグして、S〜Dの段に置いてください。", "hint"),
    bank,
    board,
  );
  paint();
  return {
    update(p: Placement) {
      current = { ...p };
      paint();
    },
    destroy() {
      cleanup();
      container.replaceChildren();
    },
  };
}
