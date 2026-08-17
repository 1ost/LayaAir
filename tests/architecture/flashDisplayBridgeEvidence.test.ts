import assert from "node:assert/strict";
import test from "node:test";
import type { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject.ts";
import type { DisplayObjectContainer } from "../../src/layaAir/flash/display/DisplayObjectContainer.ts";
import type { InteractiveObject } from "../../src/layaAir/flash/display/InteractiveObject.ts";
import type { MovieClip } from "../../src/layaAir/flash/display/MovieClip.ts";
import type { AnimatorClip2DTimeline } from "../../src/layaAir/flash/display/NativeMovieClipTimeline.ts";
import type { SimpleButton } from "../../src/layaAir/flash/display/SimpleButton.ts";
import type { Sprite } from "../../src/layaAir/flash/display/Sprite.ts";

test("Flash display bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof DisplayObject, typeof DisplayObjectContainer, typeof InteractiveObject,
        typeof MovieClip, typeof AnimatorClip2DTimeline, typeof SimpleButton, typeof Sprite] extends readonly unknown[] ? boolean : never));
});
