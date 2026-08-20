import assert from "node:assert/strict";
import test from "node:test";
import type {
    ContextMenu, ContextMenuBuiltInItems, ContextMenuItem, NativeContextMenuHostLease,
    NativeContextMenuHostOptions, installNativeContextMenuHost, isFlashContextMenu,
    isFlashContextMenuItem,
} from "../../src/layaAir/flash/ui/ContextMenu.ts";
import type {
    FlashKeyboardStateLease, Keyboard, installNativeKeyboardStateHost,
} from "../../src/layaAir/flash/ui/Keyboard.ts";
import type { Mouse } from "../../src/layaAir/flash/ui/Mouse.ts";
import type { MouseCursor } from "../../src/layaAir/flash/ui/MouseCursor.ts";
import type {
    Clipboard, NativeClipboardHost, NativeClipboardHostLease, createBrowserClipboardHost,
    installNativeClipboardHost,
} from "../../src/layaAir/flash/desktop/Clipboard.ts";
import type { ClipboardFormats } from "../../src/layaAir/flash/desktop/ClipboardFormats.ts";
import type {
    AccessibilityProperties, AccessibilityPropertiesBinding, bindAccessibilityProperties,
    isFlashAccessibilityProperties,
} from "../../src/layaAir/flash/accessibility/AccessibilityProperties.ts";

test("Flash UI host compiler surface and browser producer ownership", () => {
    assert.ok(true as boolean satisfies ([
        typeof ContextMenu, ContextMenuBuiltInItems, typeof ContextMenuItem,
        NativeContextMenuHostLease, NativeContextMenuHostOptions, typeof installNativeContextMenuHost,
        typeof isFlashContextMenu, typeof isFlashContextMenuItem, FlashKeyboardStateLease,
        typeof Keyboard, typeof installNativeKeyboardStateHost, typeof Mouse, typeof MouseCursor,
    ] extends readonly unknown[] ? boolean : never));
});

test("Flash desktop clipboard compiler surface and browser producer ownership", () => {
    assert.ok(true as boolean satisfies ([
        typeof Clipboard, NativeClipboardHost, NativeClipboardHostLease,
        typeof createBrowserClipboardHost, typeof installNativeClipboardHost, typeof ClipboardFormats,
    ] extends readonly unknown[] ? boolean : never));
});

test("Flash accessibility metadata compiler surface and DOM binding ownership", () => {
    assert.ok(true as boolean satisfies ([
        typeof AccessibilityProperties, AccessibilityPropertiesBinding,
        typeof bindAccessibilityProperties, typeof isFlashAccessibilityProperties,
    ] extends readonly unknown[] ? boolean : never));
});
