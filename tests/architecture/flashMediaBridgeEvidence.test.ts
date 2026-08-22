import assert from "node:assert/strict";
import test from "node:test";

import type { Sound } from "../../src/layaAir/flash/media/Sound.ts";
import type { SoundChannel } from "../../src/layaAir/flash/media/SoundChannel.ts";
import type { SoundLoaderContext } from "../../src/layaAir/flash/media/SoundLoaderContext.ts";
import type { SoundTransform } from "../../src/layaAir/flash/media/SoundTransform.ts";

test("Flash media bridge compiler surface", () => {
    assert.ok(true as boolean satisfies (
        typeof Sound extends unknown
            ? typeof SoundChannel extends unknown
                ? typeof SoundLoaderContext extends unknown
                    ? typeof SoundTransform extends unknown ? boolean : never
                    : never
                : never
            : never
    ));
});
