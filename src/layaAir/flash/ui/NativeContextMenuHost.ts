import { isFlashInteractiveObject, resolveFlashFocusOwner, type InteractiveObject } from "../display/InteractiveObject";
import { ContextMenuEvent } from "../events/ContextMenuEvent";
import { ContextMenuItem, isFlashContextMenu, isFlashContextMenuItem } from "./ContextMenu";

export interface NativeContextMenuHostOptions {
    readonly canvas: HTMLElement;
    readonly resolveTarget: () => unknown;
    readonly document?: Document;
}

export interface NativeContextMenuHostLease {
    readonly open: boolean;
    dismiss(): void;
    dispose(): void;
}

interface HostAuthority {
    readonly token: object;
    readonly retire: () => void;
}

const CANVAS_AUTHORITIES = new WeakMap<HTMLElement, HostAuthority>();

function findOwner(value: unknown): InteractiveObject | null {
    let current = resolveFlashFocusOwner(value);
    const seen = new Set<InteractiveObject>();
    while (current) {
        if (seen.has(current)) throw new Error("Context-menu owner ancestry is cyclic");
        seen.add(current);
        if (!current.destroyed && isFlashContextMenu(current.contextMenu)) return current;
        const parent = current.parent;
        current = isFlashInteractiveObject(parent) ? parent : null;
    }
    return null;
}

/**
 * Installs the single accessible context-menu authority for a Laya canvas.
 * Only trusted browser ingress is admitted, so selection stays inside the
 * browser user-activation stack required by clipboard and navigation APIs.
 */
export function installNativeContextMenuHost(options: NativeContextMenuHostOptions): NativeContextMenuHostLease {
    if (!options || typeof options !== "object") throw new TypeError("Native context-menu options are required");
    const canvas = options.canvas;
    const document = options.document ?? globalThis.document;
    if (!canvas || typeof canvas.addEventListener !== "function" || !document?.body)
        throw new TypeError("Native context-menu host requires a live canvas and document body");
    if (typeof options.resolveTarget !== "function")
        throw new TypeError("Native context-menu host requires a target resolver");

    CANVAS_AUTHORITIES.get(canvas)?.retire();
    const token = Object.freeze({});
    let popup: HTMLDivElement | null = null;
    let previousFocus: HTMLElement | null = null;
    let disposed = false;
    let generation = 0;

    const ownsCanvas = (): boolean => CANVAS_AUTHORITIES.get(canvas)?.token === token;
    const dismiss = (): void => {
        generation++;
        const current = popup;
        popup = null;
        current?.remove();
        const restore = previousFocus;
        previousFocus = null;
        if (restore?.isConnected) {
            try { restore.focus({ preventScroll: true }); }
            catch { /* Authority is already cleared even if a host focus method throws. */ }
        }
    };

    const activate = (event: MouseEvent | KeyboardEvent, item: ContextMenuItem,
        owner: InteractiveObject, expectedGeneration: number): void => {
        if (!event.isTrusted || disposed || !ownsCanvas() || generation !== expectedGeneration
            || !isFlashContextMenuItem(item) || !item.visible || !item.enabled) return;
        dismiss();
        item.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_ITEM_SELECT, false, false, owner, owner));
    };

    const onDocumentPointerDown = (event: Event): void => {
        if (event.isTrusted && popup && !popup.contains(event.target as Node)) dismiss();
    };
    const onWindowBlur = (): void => dismiss();

    const openFromEvent = (event: MouseEvent | KeyboardEvent, x: number, y: number): void => {
        if (!event.isTrusted || disposed || !ownsCanvas()) return;
        const owner = findOwner(options.resolveTarget());
        if (!owner) return;
        const menu = owner.contextMenu;
        if (!isFlashContextMenu(menu)) return;
        event.preventDefault();
        const rawItems = menu.customItems ?? [];
        const snapshot = Array.prototype.slice.call(rawItems) as unknown[];
        if (!snapshot.every(isFlashContextMenuItem)) return;

        dismiss();
        const callbackGeneration = generation;
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        try { (owner as unknown as { _applyNativeFocus(value: boolean): void })._applyNativeFocus(true); }
        catch (error) {
            dismiss();
            throw error;
        }
        if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
        try { menu.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_SELECT, false, false, owner, owner)); }
        catch (error) {
            dismiss();
            throw error;
        }
        if (disposed || !ownsCanvas() || generation !== callbackGeneration
            || owner.destroyed || owner.contextMenu !== menu) {
            previousFocus = null;
            return;
        }

        const items = (snapshot as ContextMenuItem[]).filter(item => item.visible);
        if (items.length === 0) {
            previousFocus = null;
            return;
        }
        const container = document.createElement("div");
        container.dataset.flashContextMenu = "true";
        container.setAttribute("role", "menu");
        Object.assign(container.style, {
            position: "fixed", left: `${x}px`, top: `${y}px`, zIndex: "2147483647",
            minWidth: "12rem", padding: "4px", color: "CanvasText", background: "Canvas",
            border: "1px solid GrayText", borderRadius: "3px", boxShadow: "0 2px 8px #0006",
            font: "menu", display: "grid",
        });
        const buttons: HTMLButtonElement[] = [];
        const buttonItems = new Map<HTMLButtonElement, ContextMenuItem>();
        for (const item of items) {
            if (item.separatorBefore) {
                const separator = document.createElement("div");
                separator.setAttribute("role", "separator");
                separator.style.borderTop = "1px solid GrayText";
                separator.style.margin = "3px 0";
                container.appendChild(separator);
            }
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "menuitem");
            button.textContent = item.caption ?? "";
            button.disabled = !item.enabled;
            button.style.cssText = "display:block;width:100%;text-align:left;border:0;padding:4px 8px;background:transparent;color:inherit;font:inherit";
            button.addEventListener("click", clickEvent => activate(clickEvent, item, owner, callbackGeneration));
            container.appendChild(button);
            if (item.enabled) {
                buttons.push(button);
                buttonItems.set(button, item);
            }
        }
        container.addEventListener("keydown", keyboardEvent => {
            if (!keyboardEvent.isTrusted || disposed || !ownsCanvas() || generation !== callbackGeneration) return;
            if (keyboardEvent.key === "Escape") {
                keyboardEvent.preventDefault();
                dismiss();
                return;
            }
            if (buttons.length === 0) return;
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const delta = keyboardEvent.key === "ArrowDown" ? 1 : keyboardEvent.key === "ArrowUp" ? -1 : 0;
            if (delta !== 0) {
                keyboardEvent.preventDefault();
                buttons[(index + delta + buttons.length) % buttons.length].focus();
            } else if ((keyboardEvent.key === "Enter" || keyboardEvent.key === " ") && index >= 0) {
                keyboardEvent.preventDefault();
                activate(keyboardEvent, buttonItems.get(buttons[index])!, owner, callbackGeneration);
            }
        });
        if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
        document.body.appendChild(container);
        popup = container;
        buttons[0]?.focus({ preventScroll: true });
    };
    const onContextMenu = (nativeEvent: Event): void => {
        const event = nativeEvent as MouseEvent;
        openFromEvent(event, event.clientX, event.clientY);
    };
    const onCanvasKeyDown = (nativeEvent: Event): void => {
        const event = nativeEvent as KeyboardEvent;
        if (!((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) return;
        const bounds = canvas.getBoundingClientRect();
        openFromEvent(event, bounds.left, bounds.bottom);
    };

    try {
        canvas.addEventListener("contextmenu", onContextMenu);
        canvas.addEventListener("keydown", onCanvasKeyDown);
        document.addEventListener("pointerdown", onDocumentPointerDown, true);
        document.defaultView?.addEventListener("blur", onWindowBlur);
    } catch (error) {
        canvas.removeEventListener("contextmenu", onContextMenu);
        canvas.removeEventListener("keydown", onCanvasKeyDown);
        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        document.defaultView?.removeEventListener("blur", onWindowBlur);
        disposed = true;
        throw error;
    }

    const retire = (): void => {
        if (disposed) return;
        disposed = true;
        generation++;
        if (ownsCanvas()) CANVAS_AUTHORITIES.delete(canvas);
        let caught = false;
        let firstError: unknown;
        const capture = (operation: () => void): void => {
            try { operation(); }
            catch (error) {
                if (!caught) {
                    caught = true;
                    firstError = error;
                }
            }
        };
        capture(() => canvas.removeEventListener("contextmenu", onContextMenu));
        capture(() => canvas.removeEventListener("keydown", onCanvasKeyDown));
        capture(() => document.removeEventListener("pointerdown", onDocumentPointerDown, true));
        capture(() => document.defaultView?.removeEventListener("blur", onWindowBlur));
        capture(dismiss);
        if (caught) throw firstError;
    };
    CANVAS_AUTHORITIES.set(canvas, { token, retire });

    return Object.freeze({
        get open(): boolean { return !disposed && ownsCanvas() && popup !== null; },
        dismiss(): void { if (!disposed && ownsCanvas()) dismiss(); },
        dispose: retire,
    });
}
