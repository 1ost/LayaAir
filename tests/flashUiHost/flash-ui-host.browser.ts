import { BrowserAdapter } from "../../src/layaAir/laya/platform/BrowserAdapter";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import {
    AccessibilityProperties, ContextMenu, ContextMenuItem, Keyboard, Mouse, MouseCursor,
    bindAccessibilityProperties, createBrowserClipboardHost, installNativeContextMenuHost,
    installNativeKeyboardStateHost,
} from "../../src/layaAir/flash";
import { ContextMenuEvent } from "../../src/layaAir/flash/events/ContextMenuEvent";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";

void run().then(result => publish({ ok: true, result }), error => publish({
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
}));

async function run(): Promise<Record<string, unknown>> {
    // Standalone bridge gate initializes the same browser adapter that Laya
    // initialization owns in a game process.
    void BrowserAdapter;
    PAL.__init__();

    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    const prior = document.createElement("button");
    prior.textContent = "prior focus";
    document.body.appendChild(prior);
    prior.focus();

    const menu = new ContextMenu();
    menu.hideBuiltInItems();
    const disabled = new ContextMenuItem("Version", true, false, true);
    const hidden = new ContextMenuItem("Hidden", false, true, false);
    const selectable = new ContextMenuItem("Copy debug info");
    menu.customItems.push(disabled, hidden, selectable);
    let ownerFocused = 0;
    const owner: { parent: null; contextMenu: ContextMenu; _applyNativeFocus(value: boolean): void } = {
        parent: null, contextMenu: menu, _applyNativeFocus(value: boolean) { if (value) ownerFocused++; },
    };
    const route: string[] = [];
    menu.addEventListener(ContextMenuEvent.MENU_SELECT, eventValue => {
        const event = eventValue as ContextMenuEvent;
        route.push(`menu:${event.target === menu}:${event.contextMenuOwner === owner}:${event.mouseTarget === owner}`);
    });
    selectable.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT, eventValue => {
        const event = eventValue as ContextMenuEvent;
        route.push(`item:${event.target === selectable}:${event.contextMenuOwner === owner}:${event.mouseTarget === owner}`);
    });
    const host = installNativeContextMenuHost({ canvas, document, resolveTarget: () => owner });

    const native = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 11, clientY: 13 });
    canvas.dispatchEvent(native);
    requireValue(native.defaultPrevented, "native context menu was not canceled");
    const popup = document.querySelector<HTMLElement>("[data-flash-context-menu=true]");
    requireValue(popup?.getAttribute("role") === "menu", "accessible menu was not rendered");
    const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>("button"));
    requireValue(buttons.length === 2 && buttons[0].disabled && buttons[1].textContent === "Copy debug info",
        "visible/enabled menu projection drifted");
    buttons[1].click();
    requireValue(!host.open && document.activeElement === prior, "selection did not close and restore focus");
    requireValue(JSON.stringify(route) === JSON.stringify(["menu:true:true:true", "item:true:true:true"]),
        "context-menu event identity drifted");

    canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    requireValue(host.open, "second context menu did not open");
    document.querySelector<HTMLElement>("[data-flash-context-menu=true]")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    requireValue(!host.open, "Escape did not dismiss context menu");
    host.dispose();
    const afterDispose = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(afterDispose);
    requireValue(!afterDispose.defaultPrevented && !host.open, "disposed context-menu host still intercepted events");

    const accessible = document.createElement("div");
    accessible.setAttribute("aria-label", "previous");
    document.body.appendChild(accessible);
    const properties = new AccessibilityProperties();
    properties.name = "Context menu owner";
    properties.description = "Right-click for diagnostics";
    properties.shortcut = "Shift+F10";
    const binding = bindAccessibilityProperties(accessible, properties);
    requireValue(accessible.getAttribute("aria-label") === "Context menu owner"
        && accessible.getAttribute("aria-description") === "Right-click for diagnostics"
        && accessible.getAttribute("aria-keyshortcuts") === "Shift+F10", "ARIA projection drifted");
    properties.silent = true;
    requireValue(accessible.getAttribute("aria-hidden") === "true", "live accessibility update drifted");
    binding.dispose();
    properties.name = "ignored after dispose";
    requireValue(accessible.getAttribute("aria-label") === "previous"
        && !accessible.hasAttribute("aria-description") && !accessible.hasAttribute("aria-hidden"),
        "accessibility teardown did not restore prior attributes");

    const keyboardLease = installNativeKeyboardStateHost(window);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "A" }));
    keyboardLease.dispose();

    Mouse.cursor = MouseCursor.BUTTON;
    requireValue(Mouse.cursor === MouseCursor.BUTTON && document.body.style.cursor === "pointer",
        "Flash-to-browser cursor mapping drifted");
    Mouse.hide();
    requireValue(String(document.body.style.cursor) === "none", "Mouse.hide did not reach the browser adapter");
    Mouse.show();
    requireValue(document.body.style.cursor === "pointer", "Mouse.show did not restore the mapped cursor");
    Mouse.cursor = MouseCursor.AUTO;

    let clipboardRejectedOutsideGesture = false;
    try { createBrowserClipboardHost(document, navigator).writeText("not activated"); }
    catch (error) { clipboardRejectedOutsideGesture = error instanceof UnsupportedFlashFeatureError; }
    const activation = (navigator as Navigator & { readonly userActivation?: { readonly isActive: boolean } }).userActivation;
    requireValue(clipboardRejectedOutsideGesture || activation?.isActive === true,
        "clipboard host reported speculative success outside user activation");

    return {
        contextMenuActualProducer: true,
        contextMenuTeardown: true,
        selectionIdentity: true,
        focusRestored: true,
        ownerFocused,
        accessibilityLiveProjection: true,
        accessibilityTeardown: true,
        mouseBrowserProjection: true,
        keyboardProducerTeardown: true,
        clipboardFailClosedOutsideGesture: clipboardRejectedOutsideGesture,
    };
}

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function publish(payload: unknown): void {
    const marker = document.createElement("pre");
    marker.id = "flash-ui-host-browser-result";
    marker.textContent = JSON.stringify(payload);
    document.body.appendChild(marker);
}
