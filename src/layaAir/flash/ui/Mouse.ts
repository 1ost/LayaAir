import { Mouse as LayaMouse } from "../../laya/utils/Mouse";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { MouseCursor } from "./MouseCursor";

const BUILT_IN_CURSOR_CSS: Readonly<Record<string, string>> = Object.freeze({
    [MouseCursor.AUTO]: "auto",
    [MouseCursor.ARROW]: "default",
    [MouseCursor.BUTTON]: "pointer",
    [MouseCursor.HAND]: "pointer",
    [MouseCursor.IBEAM]: "text",
});

let currentCursor = MouseCursor.AUTO;

function requireCursorName(value: unknown): string {
    if (value === null || value === undefined) throw new TypeError("Mouse.cursor requires a cursor name");
    const name = String(value);
    if (!Object.prototype.hasOwnProperty.call(BUILT_IN_CURSOR_CSS, name))
        throw new UnsupportedFlashFeatureError("flash.ui.Mouse.cursor", `custom cursor '${name}' is not admitted`);
    return name;
}

/** Flash cursor state projected to Laya's browser/platform cursor authority. */
export class Mouse {
    static get cursor(): string { return currentCursor; }
    static set cursor(value: unknown) {
        const name = requireCursorName(value);
        LayaMouse.cursor = BUILT_IN_CURSOR_CSS[name];
        currentCursor = name;
    }

    static get supportsCursor(): boolean {
        if (typeof document === "undefined") return false;
        if (typeof window !== "undefined" && typeof window.matchMedia === "function")
            return window.matchMedia("(pointer: fine)").matches;
        return true;
    }

    static get supportsNativeCursor(): boolean { return Mouse.supportsCursor; }
    static hide(): void {
        if (arguments.length !== 0) throw new TypeError("Mouse.hide does not accept arguments");
        LayaMouse.hide();
    }
    static show(): void {
        if (arguments.length !== 0) throw new TypeError("Mouse.show does not accept arguments");
        LayaMouse.show();
    }

    static registerCursor(_name: string, _cursor: unknown): never {
        if (arguments.length !== 2) throw new TypeError("Mouse.registerCursor requires a name and cursor data");
        throw new UnsupportedFlashFeatureError("flash.ui.Mouse.registerCursor", "custom bitmap cursors are not source-used or admitted");
    }

    static unregisterCursor(_name: string): never {
        if (arguments.length !== 1) throw new TypeError("Mouse.unregisterCursor requires a cursor name");
        throw new UnsupportedFlashFeatureError("flash.ui.Mouse.unregisterCursor", "custom bitmap cursors are not source-used or admitted");
    }

    private constructor() { throw new TypeError("Mouse is a static class"); }
}

Object.freeze(Mouse);
