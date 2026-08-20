import {
    AccessibilityProperties, AccessibilityPropertiesBinding, Clipboard, ClipboardFormats,
    ContextMenu, ContextMenuBuiltInItems, ContextMenuItem, FlashKeyboardStateLease, Keyboard,
    Mouse, NativeClipboardHost, NativeClipboardHostLease, NativeContextMenuHostLease,
    NativeContextMenuHostOptions, bindAccessibilityProperties, createBrowserClipboardHost,
    installNativeClipboardHost, installNativeContextMenuHost, installNativeKeyboardStateHost,
} from "../../src/layaAir/flash";

const menu = new ContextMenu();
const builtIns: ContextMenuBuiltInItems = menu.builtInItems;
menu.customItems.push(new ContextMenuItem("Copy"));
const contextOptions: NativeContextMenuHostOptions = {
    canvas: document.createElement("canvas"), resolveTarget: () => null,
};
const contextLease: NativeContextMenuHostLease = installNativeContextMenuHost(contextOptions);
contextLease.dispose();

const keyboardLease: FlashKeyboardStateLease = installNativeKeyboardStateHost(window);
keyboardLease.dispose();
const key: number = Keyboard.SPACE;
Mouse.cursor = "auto";

const clipboardHost: NativeClipboardHost = createBrowserClipboardHost();
const clipboardLease: NativeClipboardHostLease = installNativeClipboardHost(clipboardHost);
const copied: boolean = Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, "text");
clipboardLease.dispose();

const properties = new AccessibilityProperties();
const binding: AccessibilityPropertiesBinding = bindAccessibilityProperties(document.body, properties);
binding.update(null);
binding.dispose();

export { binding, builtIns, copied, key };
