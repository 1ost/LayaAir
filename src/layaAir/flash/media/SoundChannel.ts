import type { SoundChannel as LayaSoundChannel } from "../../laya/media/SoundChannel";
import { Event } from "../events/Event";
import { EventDispatcher } from "../events/EventDispatcher";
import { SoundTransform } from "./SoundTransform";

const SOUND_CHANNEL_TOKEN = Symbol("LayaAir.flash.SoundChannel");
const SOUND_CHANNEL_VALUES = new WeakSet<object>();

/** Flash playback handle backed by exactly one native Laya sound channel. */
export class SoundChannel extends EventDispatcher {
    readonly #native: LayaSoundChannel;
    #transform = new SoundTransform();
    #terminal = false;

    /** @internal Sound creates channels after native playback admission succeeds. */
    constructor(token: typeof SOUND_CHANNEL_TOKEN, native: LayaSoundChannel) {
        if (token !== SOUND_CHANNEL_TOKEN || native == null)
            throw new TypeError("SoundChannel is created only by a canonical Sound");
        super();
        this.#native = native;
        SOUND_CHANNEL_VALUES.add(this);
    }

    get position(): number {
        return this.#native.position * 1000;
    }

    get leftPeak(): number { return 0; }
    get rightPeak(): number { return 0; }

    get soundTransform(): SoundTransform {
        return SoundTransform.copy(this.#transform);
    }

    set soundTransform(value: SoundTransform) {
        const snapshot = SoundTransform.copy(value);
        this.#transform = snapshot;
        this.#native.volume = snapshot.volume;
        this.#native.pan = snapshot.pan;
    }

    stop(): void {
        this.#terminal = true;
        this.#native.stop();
    }

    /**
     * @internal Converts one native terminal callback into Flash semantics.
     * Returns true only when the owning Sound must publish IOErrorEvent.IO_ERROR.
     */
    complete(success: boolean): boolean {
        if (this.#terminal) return false;
        this.#terminal = true;
        if (!success) return true;
        this.dispatchEvent(new Event(Event.SOUND_COMPLETE));
        return false;
    }
}

/** @internal Factory kept module-private from ordinary callers. */
export function createFlashSoundChannel(native: LayaSoundChannel): SoundChannel {
    return new SoundChannel(SOUND_CHANNEL_TOKEN, native);
}

/** @internal Nominal proof for source-shaped event targets. */
export function isFlashSoundChannel(value: unknown): value is SoundChannel {
    return typeof value === "object" && value !== null && SOUND_CHANNEL_VALUES.has(value);
}
