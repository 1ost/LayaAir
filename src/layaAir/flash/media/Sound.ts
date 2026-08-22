import { SoundManager } from "../../laya/media/SoundManager";
import { EventDispatcher } from "../events/EventDispatcher";
import { URLRequest, snapshotNativeLoaderRequest } from "../net/URLRequest";
import {
    createFlashSoundChannel, SoundChannel,
} from "./SoundChannel";
import { SoundLoaderContext, isFlashSoundLoaderContext } from "./SoundLoaderContext";
import { SoundTransform } from "./SoundTransform";

const SOUND_VALUES = new WeakSet<object>();

function requireContext(value: SoundLoaderContext | null): void {
    if (value !== null && !isFlashSoundLoaderContext(value))
        throw new TypeError("Sound context must be a canonical SoundLoaderContext");
}

function flashLoopCount(value: number): number {
    const loops = value | 0;
    return loops <= 0 ? 1 : loops + 1;
}

/** Flash-shaped sound asset that delegates playback to LayaAir SoundManager. */
export class Sound extends EventDispatcher {
    #url: string | null = null;
    #context: SoundLoaderContext | null = null;

    constructor(stream: URLRequest | null = null, context: SoundLoaderContext | null = null) {
        super();
        SOUND_VALUES.add(this);
        if (stream !== null) this.load(stream, context);
        else requireContext(context);
    }

    get url(): string | null { return this.#url; }
    get bytesLoaded(): number { return 0; }
    get bytesTotal(): number { return 0; }
    get isBuffering(): boolean { return false; }
    get length(): number { return 0; }
    get id3(): Readonly<Record<string, never>> { return Object.freeze(Object.create(null)); }

    load(stream: URLRequest, context: SoundLoaderContext | null = null): void {
        requireContext(context);
        this.#url = snapshotNativeLoaderRequest(stream);
        this.#context = context;
    }

    play(startTime = 0, loops = 0, soundTransform: SoundTransform | null = null): SoundChannel | null {
        if (this.#url === null) return null;
        const startSeconds = Math.max(0, Number(startTime) || 0) / 1000;
        let channel: SoundChannel | null = null;
        const native = SoundManager.playSound(
            this.#url,
            flashLoopCount(loops),
            ((success?: boolean) => channel?.complete(success === true)) as () => void,
            startSeconds,
        );
        if (native == null) return null;
        channel = createFlashSoundChannel(native);
        channel.soundTransform = SoundTransform.copy(soundTransform);
        return channel;
    }

    close(): void {
        this.#context = null;
    }
}

/** @internal Nominal proof for source-shaped event targets. */
export function isFlashSound(value: unknown): value is Sound {
    return typeof value === "object" && value !== null && SOUND_VALUES.has(value);
}
