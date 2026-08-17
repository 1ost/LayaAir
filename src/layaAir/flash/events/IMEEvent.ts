import { TextEvent } from "./TextEvent";

export type IMECompositionPhase = "start" | "update" | "end";

/** Explicit native IME composition seam; no AVM IME client is executed. */
export class IMEEvent extends TextEvent {
    static readonly IME_COMPOSITION = "imeComposition";

    constructor(type: string, bubbles = true, cancelable = false, text = "",
        readonly compositionPhase: IMECompositionPhase = "update",
        readonly selectionBeginIndex = 0, readonly selectionEndIndex = selectionBeginIndex,
        readonly nativeEvent: unknown = null) {
        super(type, bubbles, cancelable, text);
        if (type !== IMEEvent.IME_COMPOSITION)
            throw new TypeError("IMEEvent.type must be imeComposition");
        if (compositionPhase !== "start" && compositionPhase !== "update" && compositionPhase !== "end")
            throw new TypeError("IMEEvent.compositionPhase must be start, update or end");
        if (!Number.isInteger(selectionBeginIndex) || selectionBeginIndex < 0
            || !Number.isInteger(selectionEndIndex) || selectionEndIndex < selectionBeginIndex)
            throw new TypeError("IMEEvent selection must be ordered nonnegative integers");
    }

    override clone(): IMEEvent {
        return new IMEEvent(this.type, this.bubbles, this.cancelable, this.text, this.compositionPhase,
            this.selectionBeginIndex, this.selectionEndIndex, this.nativeEvent);
    }
}
