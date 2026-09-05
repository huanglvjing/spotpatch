import { createButton, createMarkedElement } from "./dom.js";

/** Shared select-only picker: native value contract, one accessible custom control. */
export function createAskPicker(document: Document, onViewChange: () => void) {
  const root = createMarkedElement(document, "div");
  root.className = "spotpatch-ask-executor-picker";
  const trigger = createButton(document, "", "spotpatch-ask-executor");
  trigger.id = `spotpatch-ask-picker-${Math.random().toString(36).slice(2)}`;
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const text = createMarkedElement(document, "span");
  trigger.append(text);
  const menu = createMarkedElement(document, "div");
  menu.id = `${trigger.id}-menu`;
  menu.className = "spotpatch-ask-executor-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  trigger.setAttribute("aria-controls", menu.id);
  const select = createMarkedElement(document, "select");
  select.className = "spotpatch-ask-executor-native";
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  root.append(trigger, menu, select);

  function close(focus = false): void {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    if (focus) trigger.focus({ preventScroll: true });
    onViewChange();
  }

  function activate(index: number): void {
    const options = [...menu.children] as HTMLElement[];
    const active = options[index];
    if (active === undefined) return;
    for (const option of options) option.dataset.active = String(option === active);
    trigger.setAttribute("aria-activedescendant", active.id);
    const itemRect = active.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (itemRect.top < menuRect.top) menu.scrollTop -= menuRect.top - itemRect.top;
    else if (itemRect.bottom > menuRect.bottom)
      menu.scrollTop += itemRect.bottom - menuRect.bottom;
  }

  function open(): void {
    if (trigger.disabled || !menu.hidden) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    activate(Math.max(0, select.selectedIndex));
    onViewChange();
  }

  function sync(): void {
    text.textContent = select.selectedOptions[0]?.textContent ?? "";
    trigger.title = text.textContent;
    trigger.dataset.empty = String(select.value.length === 0);
    for (const option of [...menu.children] as HTMLElement[]) {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.value === select.value),
      );
    }
  }

  function choose(value: string): void {
    if (trigger.disabled) return;
    select.value = value;
    sync();
    close(true);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function rebuild(): void {
    close();
    menu.replaceChildren();
    for (const [index, option] of [...select.options].entries()) {
      const item = createMarkedElement(document, "div");
      item.id = `${menu.id}-${String(index)}`;
      item.className = "spotpatch-ask-executor-option";
      item.setAttribute("role", "option");
      item.dataset.value = option.value;
      item.textContent = option.textContent;
      item.title = option.textContent;
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      item.addEventListener("click", () => {
        choose(option.value);
      });
      menu.append(item);
    }
    sync();
  }

  trigger.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (["Enter", " "].includes(event.key) && !menu.hidden) {
      event.preventDefault();
      const active = [...menu.children].find(
        (item) => item.id === trigger.getAttribute("aria-activedescendant"),
      ) as HTMLElement | undefined;
      if (active?.dataset.value !== undefined) choose(active.dataset.value);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (menu.hidden) {
      open();
      return;
    }
    const options = [...menu.children];
    const index = options.findIndex(
      (item) => item.id === trigger.getAttribute("aria-activedescendant"),
    );
    activate(
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length,
    );
  });
  root.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget))
      close();
  });
  const outside = (event: PointerEvent): void => {
    if (!event.composedPath().includes(root)) close();
  };
  document.addEventListener("pointerdown", outside);
  select.addEventListener("change", sync);
  return {
    root,
    trigger,
    select,
    rebuild,
    close,
    setDisabled(disabled: boolean): void {
      select.disabled = disabled;
      trigger.disabled = disabled || select.options.length < 2;
      trigger.dataset.expandable = String(!trigger.disabled);
      if (trigger.disabled) close();
    },
    dispose(): void {
      document.removeEventListener("pointerdown", outside);
    },
  };
}
