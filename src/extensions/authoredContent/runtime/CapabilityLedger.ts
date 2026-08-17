const ADMITTED = new Set<string>([
    "flash.events.Event", "flash.events.EventDispatcher", "flash.events.MouseEvent",
    "flash.display.DisplayObject", "flash.display.InteractiveObject", "flash.display.DisplayObjectContainer",
    "flash.display.Sprite", "flash.display.SimpleButton", "flash.display.MovieClip",
    "flash.text.TextField", "native.AnimatorClip2D", "native.named-instance-linkage", "as3.method-closure"
]);

/** Fail-closed runtime seam for the content-addressed source capability census. */
export function assertAuthoredRuntimeCapability(id: string): void {
    if (!ADMITTED.has(id)) throw new Error(`Authored runtime capability is not admitted: ${id}`);
}

export function admittedAuthoredRuntimeCapabilities(): readonly string[] {
    return Object.freeze([...ADMITTED].sort());
}
