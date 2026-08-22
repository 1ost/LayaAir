const SOUND_TRANSFORM_VALUES = new WeakSet<object>();

/** Mutable Flash sound-mix transform. Values are retained without coercive clamping. */
export class SoundTransform {
    volume: number;
    pan: number;
    leftToLeft: number;
    leftToRight: number;
    rightToLeft: number;
    rightToRight: number;

    constructor(volume = 1, panning = 0) {
        this.volume = Number(volume);
        this.pan = Number(panning);
        this.leftToLeft = 1;
        this.leftToRight = 0;
        this.rightToLeft = 0;
        this.rightToRight = 1;
        SOUND_TRANSFORM_VALUES.add(this);
    }

    /** @internal Owns a snapshot so later caller mutation cannot alter a channel implicitly. */
    static copy(value: SoundTransform | null): SoundTransform {
        if (value === null) return new SoundTransform();
        if (!isFlashSoundTransform(value))
            throw new TypeError("soundTransform must be a canonical SoundTransform");
        const copy = new SoundTransform(value.volume, value.pan);
        copy.leftToLeft = value.leftToLeft;
        copy.leftToRight = value.leftToRight;
        copy.rightToLeft = value.rightToLeft;
        copy.rightToRight = value.rightToRight;
        return copy;
    }
}

/** @internal Nominal proof used by Sound and SoundChannel. */
export function isFlashSoundTransform(value: unknown): value is SoundTransform {
    return typeof value === "object" && value !== null && SOUND_TRANSFORM_VALUES.has(value);
}
