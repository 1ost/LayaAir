import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated LayaFlash declarations expose the admitted UI host family", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    for (const name of ["AccessibilityProperties", "Clipboard", "ClipboardFormats", "ContextMenu",
        "ContextMenuItem", "Keyboard", "Mouse", "bindAccessibilityProperties",
        "installNativeClipboardHost", "installNativeContextMenuHost", "installNativeKeyboardStateHost"])
        assert.match(declaration, new RegExp(`\\b${name}\\b`), `Missing declaration for ${name}`);
    for (const privateName of ["isFlashAccessibilityProperties", "isFlashContextMenu", "isFlashContextMenuItem"])
        assert.doesNotMatch(declaration, new RegExp(`\\b${privateName}\\b`), `Private nominal proof leaked: ${privateName}`);
});
