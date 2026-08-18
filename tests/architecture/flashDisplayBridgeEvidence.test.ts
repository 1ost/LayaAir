import assert from "node:assert/strict";
import test from "node:test";
import type { DisplayObject, isFlashDisplayObject } from "../../src/layaAir/flash/display/DisplayObject.ts";
import type { DisplayObjectContainer, isFlashDisplayObjectContainer } from "../../src/layaAir/flash/display/DisplayObjectContainer.ts";
import type { FlashStageBootstrap, FlashStageBootstrapOptions, FlashStageBoundary } from "../../src/layaAir/flash/display/FlashStageBoundary.ts";
import type { Graphics, isFlashGraphics } from "../../src/layaAir/flash/display/Graphics.ts";
import type { IBitmapDrawable } from "../../src/layaAir/flash/display/IBitmapDrawable.ts";
import type { isFlashBitmapDrawable } from "../../src/layaAir/flash/display/IBitmapDrawable.ts";
import type { InteractiveObject, isFlashInteractiveObject, resolveFlashFocusOwner } from "../../src/layaAir/flash/display/InteractiveObject.ts";
import type { FlashFrameReference, MovieClip, isFlashMovieClip } from "../../src/layaAir/flash/display/MovieClip.ts";
import type { AnimatorClip2DTimeline, NativeMovieClipTimeline } from "../../src/layaAir/flash/display/NativeMovieClipTimeline.ts";
import type { SimpleButton, isFlashSimpleButton } from "../../src/layaAir/flash/display/SimpleButton.ts";
import type { Shape, isFlashShape } from "../../src/layaAir/flash/display/Shape.ts";
import type { Sprite, isFlashSprite } from "../../src/layaAir/flash/display/Sprite.ts";
import type { Bitmap, isFlashBitmap } from "../../src/layaAir/flash/display/Bitmap.ts";
import type { BitmapData, acquireBitmapDataTexture, isFlashBitmapData, observeBitmapData } from "../../src/layaAir/flash/display/BitmapData.ts";
import type { BitmapDataChannel } from "../../src/layaAir/flash/display/BitmapDataChannel.ts";
import type { PixelSnapping } from "../../src/layaAir/flash/display/PixelSnapping.ts";
import type { StageAlign } from "../../src/layaAir/flash/display/StageAlign.ts";
import type { GradientType } from "../../src/layaAir/flash/display/GradientType.ts";
import type { BlendMode } from "../../src/layaAir/flash/display/BlendMode.ts";

test("Flash display bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof DisplayObject, typeof DisplayObjectContainer, typeof InteractiveObject,
        typeof FlashStageBoundary,
        typeof Graphics, IBitmapDrawable, typeof isFlashBitmapDrawable, typeof MovieClip, typeof AnimatorClip2DTimeline,
        typeof Shape, typeof SimpleButton, typeof Sprite, typeof Bitmap, typeof BitmapData,
        typeof BitmapDataChannel, typeof PixelSnapping,
        typeof StageAlign, typeof GradientType, typeof BlendMode,
        typeof isFlashBitmap, typeof acquireBitmapDataTexture, typeof isFlashBitmapData, typeof observeBitmapData,
        typeof isFlashDisplayObject, typeof isFlashDisplayObjectContainer, FlashStageBootstrap, FlashStageBootstrapOptions,
        typeof isFlashGraphics, typeof isFlashInteractiveObject, typeof resolveFlashFocusOwner,
        FlashFrameReference, typeof isFlashMovieClip, NativeMovieClipTimeline,
        typeof isFlashShape, typeof isFlashSimpleButton, typeof isFlashSprite] extends readonly unknown[] ? boolean : never));
});
