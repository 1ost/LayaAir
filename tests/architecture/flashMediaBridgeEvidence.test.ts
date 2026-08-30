import assert from "node:assert/strict";
import test from "node:test";

import type { Sound, isFlashSound } from "../../src/layaAir/flash/media/Sound.ts";
import type {
    SoundChannel, createFlashSoundChannel, isFlashSoundChannel
} from "../../src/layaAir/flash/media/SoundChannel.ts";
import type {
    SoundLoaderContext, isFlashSoundLoaderContext
} from "../../src/layaAir/flash/media/SoundLoaderContext.ts";
import type { SoundTransform, isFlashSoundTransform } from "../../src/layaAir/flash/media/SoundTransform.ts";

test("Flash media bridge compiler surface", () => {
    assert.ok(true as boolean satisfies (
        [typeof Sound, typeof isFlashSound,
            typeof SoundChannel, typeof createFlashSoundChannel, typeof isFlashSoundChannel,
            typeof SoundLoaderContext, typeof isFlashSoundLoaderContext,
            typeof SoundTransform, typeof isFlashSoundTransform] extends readonly unknown[] ? boolean : never
    ));
});
