const SOUND_LOADER_CONTEXT_VALUES = new WeakSet<object>();

/** Flash-shaped sound loading policy retained by the native audio bridge. */
export class SoundLoaderContext {
    bufferTime: number;
    checkPolicyFile: boolean;

    constructor(bufferTime = 1000, checkPolicyFile = false) {
        this.bufferTime = Number(bufferTime);
        this.checkPolicyFile = Boolean(checkPolicyFile);
        SOUND_LOADER_CONTEXT_VALUES.add(this);
    }
}

/** @internal Nominal proof used before accepting a caller-supplied context. */
export function isFlashSoundLoaderContext(value: unknown): value is SoundLoaderContext {
    return typeof value === "object" && value !== null
        && SOUND_LOADER_CONTEXT_VALUES.has(value);
}
