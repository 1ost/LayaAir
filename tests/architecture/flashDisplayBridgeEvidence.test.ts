import assert from "node:assert/strict";
import test from "node:test";
import type { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject.ts";
import type { DisplayObjectContainer } from "../../src/layaAir/flash/display/DisplayObjectContainer.ts";
import type { Graphics } from "../../src/layaAir/flash/display/Graphics.ts";
import type { IBitmapDrawable } from "../../src/layaAir/flash/display/IBitmapDrawable.ts";
import type { isFlashBitmapDrawable } from "../../src/layaAir/flash/display/IBitmapDrawable.ts";
import type { InteractiveObject } from "../../src/layaAir/flash/display/InteractiveObject.ts";
import type { MovieClip } from "../../src/layaAir/flash/display/MovieClip.ts";
import type { AnimatorClip2DTimeline } from "../../src/layaAir/flash/display/NativeMovieClipTimeline.ts";
import type { SimpleButton } from "../../src/layaAir/flash/display/SimpleButton.ts";
import type { Shape } from "../../src/layaAir/flash/display/Shape.ts";
import type { Sprite } from "../../src/layaAir/flash/display/Sprite.ts";
import type { Bitmap } from "../../src/layaAir/flash/display/Bitmap.ts";
import type { BitmapData } from "../../src/layaAir/flash/display/BitmapData.ts";
import type { BitmapDataChannel } from "../../src/layaAir/flash/display/BitmapDataChannel.ts";
import type { PixelSnapping } from "../../src/layaAir/flash/display/PixelSnapping.ts";

test("Flash display bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof DisplayObject, typeof DisplayObjectContainer, typeof InteractiveObject,
        typeof Graphics, IBitmapDrawable, typeof isFlashBitmapDrawable, typeof MovieClip, typeof AnimatorClip2DTimeline,
        typeof Shape, typeof SimpleButton, typeof Sprite, typeof Bitmap, typeof BitmapData,
        typeof BitmapDataChannel, typeof PixelSnapping] extends readonly unknown[] ? boolean : never));
});
