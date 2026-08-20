import { BrowserAdapter } from "../../src/layaAir/laya/platform/BrowserAdapter";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import {
    AccessibilityProperties, Clipboard, ClipboardFormats, ContextMenu, ContextMenuItem,
    InteractiveObject, Keyboard, Mouse, MouseCursor, bindAccessibilityProperties,
    createBrowserClipboardHost, installNativeClipboardHost, installNativeContextMenuHost,
    installNativeKeyboardStateHost,
} from "../../src/layaAir/flash";
import { ContextMenuEvent } from "../../src/layaAir/flash/events/ContextMenuEvent";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";

interface BrowserGateState {
    route: string[];
    trustedDefaultStates: boolean[];
    trustedKeyboardDefaultStates: boolean[];
    ownerFocused: number;
    clipboardAccepted: boolean;
    clipboardError: string | null;
    selectionFocusRestored: boolean;
    syntheticContextIgnored: boolean;
    programmaticSelectionIgnored: boolean;
    accessibilitySuccessorPreserved: boolean;
    accessibilityBaselineRestored: boolean;
    mouseBrowserProjection: boolean;
    keyboardProducerTeardown: boolean;
    syntheticKeyboardIgnored: boolean;
    clipboardFailClosedOutsideGesture: boolean;
    disposeSelectionDispatches: number;
    successorSelectionDispatches: number;
    successorInstalled: boolean;
}

void BrowserAdapter;
PAL.__init__();
LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
document.body.style.margin = "0";

const state: BrowserGateState = {
    route: [], trustedDefaultStates: [], trustedKeyboardDefaultStates: [], ownerFocused: 0,
    clipboardAccepted: false, clipboardError: null, selectionFocusRestored: false,
    syntheticContextIgnored: false, programmaticSelectionIgnored: false,
    accessibilitySuccessorPreserved: false, accessibilityBaselineRestored: false,
    mouseBrowserProjection: false, keyboardProducerTeardown: false,
    syntheticKeyboardIgnored: false,
    clipboardFailClosedOutsideGesture: false,
    disposeSelectionDispatches: 0, successorSelectionDispatches: 0, successorInstalled: false,
};

class TestOwner extends InteractiveObject {
    protected override _applyNativeFocus(value: boolean): void {
        if (value) state.ownerFocused++;
    }
}

function canvasAt(top: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 70;
    canvas.style.cssText = `position:absolute;left:10px;top:${top}px;width:240px;height:70px;border:1px solid black`;
    document.body.appendChild(canvas);
    return canvas;
}

const prior = document.createElement("button");
prior.textContent = "prior focus";
prior.style.cssText = "position:absolute;left:300px;top:10px";
document.body.appendChild(prior);
prior.focus();

const primaryCanvas = canvasAt(10);
primaryCanvas.tabIndex = 0;
let focusBeforePrimaryMenu: Element | null = null;
primaryCanvas.addEventListener("contextmenu", event => {
    if (event.isTrusted) focusBeforePrimaryMenu = document.activeElement;
}, true);
const primaryOwner = new TestOwner();
const primaryMenu = new ContextMenu();
primaryMenu.hideBuiltInItems();
const disabled = new ContextMenuItem("Version", true, false, true);
const hidden = new ContextMenuItem("Hidden", false, true, false);
const selectable = new ContextMenuItem("Copy debug info");
primaryMenu.customItems.push(disabled, hidden, selectable);
primaryOwner.contextMenu = primaryMenu;
primaryMenu.addEventListener(ContextMenuEvent.MENU_SELECT, eventValue => {
    const event = eventValue as ContextMenuEvent;
    state.route.push(`menu:${event.target === primaryMenu}:${event.contextMenuOwner === primaryOwner}:${event.mouseTarget === primaryOwner}`);
});
selectable.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT, eventValue => {
    const event = eventValue as ContextMenuEvent;
    state.route.push(`item:${event.target === selectable}:${event.contextMenuOwner === primaryOwner}:${event.mouseTarget === primaryOwner}`);
    state.selectionFocusRestored = document.activeElement === focusBeforePrimaryMenu;
    try { state.clipboardAccepted = Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, "trusted-copy"); }
    catch (error) { state.clipboardError = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
});
const clipboardLease = installNativeClipboardHost(createBrowserClipboardHost(document, navigator));
const firstHost = installNativeContextMenuHost({ canvas: primaryCanvas, document, resolveTarget: () => primaryOwner });
const primaryHost = installNativeContextMenuHost({ canvas: primaryCanvas, document, resolveTarget: () => primaryOwner });
primaryCanvas.addEventListener("contextmenu", event => {
    if (event.isTrusted) state.trustedDefaultStates.push(event.defaultPrevented);
});
primaryCanvas.addEventListener("keydown", event => {
    if (event.isTrusted && ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu"))
        state.trustedKeyboardDefaultStates.push(event.defaultPrevented);
});
const synthetic = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 });
primaryCanvas.dispatchEvent(synthetic);
state.syntheticContextIgnored = !synthetic.defaultPrevented && !firstHost.open && !primaryHost.open;

const reentrantCanvas = canvasAt(100);
const reentrantOwner = new TestOwner();
const reentrantMenu = new ContextMenu();
reentrantMenu.customItems.push(new ContextMenuItem("Must not appear"));
reentrantOwner.contextMenu = reentrantMenu;
let reentrantHost = installNativeContextMenuHost({
    canvas: reentrantCanvas, document, resolveTarget: () => reentrantOwner,
});
reentrantMenu.addEventListener(ContextMenuEvent.MENU_SELECT, () => reentrantHost.dispose());

const forgedCanvas = canvasAt(190);
const forgedOwner = new TestOwner();
const forgedMenu = new ContextMenu();
forgedMenu.customItems.push(new ContextMenuItem("Canonical"));
(forgedMenu.customItems as unknown[]).push(Object.freeze({ caption: "Forged", enabled: true, visible: true }));
forgedOwner.contextMenu = forgedMenu;
const forgedHost = installNativeContextMenuHost({ canvas: forgedCanvas, document, resolveTarget: () => forgedOwner });

const structuralCanvas = canvasAt(280);
const structuralMenu = new ContextMenu();
structuralMenu.customItems.push(new ContextMenuItem("Structural owner must not appear"));
const structuralOwner: { parent: null; contextMenu: ContextMenu } = { parent: null, contextMenu: structuralMenu };
const structuralHost = installNativeContextMenuHost({
    canvas: structuralCanvas, document, resolveTarget: () => structuralOwner,
});
structuralCanvas.addEventListener("contextmenu", event => {
    if (event.isTrusted) state.route.push(`structural-default:${event.defaultPrevented}`);
});

const disposeSelectionCanvas = canvasAt(370);
disposeSelectionCanvas.tabIndex = 0;
const disposeSelectionOwner = new TestOwner();
const disposeSelectionMenu = new ContextMenu();
const disposeSelectionItem = new ContextMenuItem("Dispose during focus restoration");
disposeSelectionMenu.customItems.push(disposeSelectionItem);
disposeSelectionOwner.contextMenu = disposeSelectionMenu;
disposeSelectionItem.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT,
    () => state.disposeSelectionDispatches++);
let disposeSelectionArmed = false;
let disposeSelectionHost = installNativeContextMenuHost({
    canvas: disposeSelectionCanvas, document, resolveTarget: () => disposeSelectionOwner,
});
const disposeSelectionRestore = document.createElement("button");
disposeSelectionRestore.textContent = "dispose selection restore";
document.body.appendChild(disposeSelectionRestore);
disposeSelectionCanvas.addEventListener("contextmenu", event => {
    if (!event.isTrusted || !disposeSelectionArmed) return;
    disposeSelectionArmed = false;
    const restore = document.activeElement;
    if (restore instanceof HTMLElement)
        restore.addEventListener("focus", () => disposeSelectionHost.dispose(), { once: true });
}, true);

const successorSelectionCanvas = canvasAt(460);
successorSelectionCanvas.tabIndex = 0;
const successorSelectionOwner = new TestOwner();
const successorSelectionMenu = new ContextMenu();
const successorSelectionItem = new ContextMenuItem("Install successor during focus restoration");
successorSelectionMenu.customItems.push(successorSelectionItem);
successorSelectionOwner.contextMenu = successorSelectionMenu;
successorSelectionItem.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT,
    () => state.successorSelectionDispatches++);
const predecessorSelectionHost = installNativeContextMenuHost({
    canvas: successorSelectionCanvas, document, resolveTarget: () => successorSelectionOwner,
});
let successorSelectionHost: ReturnType<typeof installNativeContextMenuHost> | null = null;
const successorSelectionRestore = document.createElement("button");
successorSelectionRestore.textContent = "successor selection restore";
document.body.appendChild(successorSelectionRestore);
let successorSelectionArmed = false;
successorSelectionCanvas.addEventListener("contextmenu", event => {
    if (!event.isTrusted || !successorSelectionArmed) return;
    successorSelectionArmed = false;
    const restore = document.activeElement;
    if (restore instanceof HTMLElement) restore.addEventListener("focus", () => {
        successorSelectionHost = installNativeContextMenuHost({
            canvas: successorSelectionCanvas, document, resolveTarget: () => successorSelectionOwner,
        });
        state.successorInstalled = true;
    }, { once: true });
}, true);

const accessible = document.createElement("div");
accessible.setAttribute("aria-label", "original");
document.body.appendChild(accessible);
const firstProperties = new AccessibilityProperties();
firstProperties.name = "first";
const firstBinding = bindAccessibilityProperties(accessible, firstProperties);
const secondProperties = new AccessibilityProperties();
secondProperties.name = "second";
secondProperties.description = "current description";
const secondBinding = bindAccessibilityProperties(accessible, secondProperties);
firstBinding.dispose();
state.accessibilitySuccessorPreserved = accessible.getAttribute("aria-label") === "second"
    && accessible.getAttribute("aria-description") === "current description";
secondBinding.dispose();
state.accessibilityBaselineRestored = accessible.getAttribute("aria-label") === "original"
    && !accessible.hasAttribute("aria-description");

const keyboardLease = installNativeKeyboardStateHost(window);
const syntheticKeyboard = new KeyboardEvent("keydown", { key: "CapsLock" });
Object.defineProperty(syntheticKeyboard, "getModifierState", { value: () => true });
window.dispatchEvent(syntheticKeyboard);
state.syntheticKeyboardIgnored = Keyboard.capsLock === false && Keyboard.numLock === false;
keyboardLease.dispose();
state.keyboardProducerTeardown = Keyboard.capsLock === false && Keyboard.numLock === false;

Mouse.cursor = MouseCursor.BUTTON;
const pointerProjected = Mouse.cursor === MouseCursor.BUTTON && document.body.style.cursor === "pointer";
Mouse.hide();
const hiddenProjected = String(document.body.style.cursor) === "none";
Mouse.show();
const shownProjected = document.body.style.cursor === "pointer";
Mouse.cursor = MouseCursor.AUTO;
state.mouseBrowserProjection = pointerProjected && hiddenProjected && shownProjected;

try { createBrowserClipboardHost(document, navigator).writeText("not activated"); }
catch (error) { state.clipboardFailClosedOutsideGesture = error instanceof UnsupportedFlashFeatureError; }

Object.assign(globalThis, {
    __flashUiHostReady: true,
    __flashUiHostTest: {
        state, firstHost, primaryHost, reentrantHost, forgedHost, structuralHost, prior,
        disposeSelectionHost, predecessorSelectionHost, disposeSelectionRestore, successorSelectionRestore,
        get successorSelectionOpen(): boolean { return successorSelectionHost?.open ?? false; },
        armDisposeSelection(): void { disposeSelectionArmed = true; },
        armSuccessorSelection(): void { successorSelectionArmed = true; },
        programmaticSelection(): void {
            const before = state.route.length;
            document.querySelector<HTMLButtonElement>("[data-flash-context-menu=true] button:not(:disabled):last-of-type")?.click();
            state.programmaticSelectionIgnored = state.route.length === before && primaryHost.open;
        },
        disposePrimary(): void { primaryHost.dispose(); },
        finish(): Record<string, unknown> {
            const result = {
                ...state,
                duplicateAuthorityRetired: !firstHost.open,
                primaryOpen: primaryHost.open,
                reentrantOpen: reentrantHost.open,
                forgedOpen: forgedHost.open,
                structuralOpen: structuralHost.open,
                popupCount: document.querySelectorAll("[data-flash-context-menu=true]").length,
            };
            firstHost.dispose();
            primaryHost.dispose();
            reentrantHost.dispose();
            forgedHost.dispose();
            structuralHost.dispose();
            disposeSelectionHost.dispose();
            predecessorSelectionHost.dispose();
            successorSelectionHost?.dispose();
            clipboardLease.dispose();
            return result;
        },
    },
});
