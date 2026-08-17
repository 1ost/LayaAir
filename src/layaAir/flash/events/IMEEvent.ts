import { TextEvent } from "./TextEvent";

/** Explicit native IME composition seam; no AVM IME client is executed. */
export class IMEEvent extends TextEvent {
    static readonly IME_COMPOSITION = "imeComposition";

    constructor(type: string, bubbles = false, cancelable = false, text = "",
        readonly imeClient: unknown = null) {
        super(type, bubbles, cancelable, text);
        if (type !== IMEEvent.IME_COMPOSITION)
            throw new TypeError("IMEEvent.type must be imeComposition");
    }

    override clone(): IMEEvent {
        return new IMEEvent(this.type, this.bubbles, this.cancelable, this.text, this.imeClient);
    }
}
