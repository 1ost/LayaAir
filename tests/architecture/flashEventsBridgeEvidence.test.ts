import assert from "node:assert/strict";
import test from "node:test";
import type { Event, EventPhase, isFlashEvent } from "../../src/layaAir/flash/events/Event.ts";
import type { EventDispatcher, IEventDispatcher, isFlashEventDispatcher } from "../../src/layaAir/flash/events/EventDispatcher.ts";
import type { ErrorEvent, isFlashErrorEvent } from "../../src/layaAir/flash/events/ErrorEvent.ts";
import type { ContextMenuEvent, isFlashContextMenuEvent } from "../../src/layaAir/flash/events/ContextMenuEvent.ts";
import type { FocusEvent, isFlashFocusEvent } from "../../src/layaAir/flash/events/FocusEvent.ts";
import type { HTTPStatusEvent, isFlashHTTPStatusEvent } from "../../src/layaAir/flash/events/HTTPStatusEvent.ts";
import type { FlashEventListener, FlashEventRouter, NativeEventHost } from "../../src/layaAir/flash/events/FlashEventRouter.ts";
import type { IMEEvent } from "../../src/layaAir/flash/events/IMEEvent.ts";
import type { IOErrorEvent, isFlashIOErrorEvent } from "../../src/layaAir/flash/events/IOErrorEvent.ts";
import type { KeyboardEvent, isFlashKeyboardEvent } from "../../src/layaAir/flash/events/KeyboardEvent.ts";
import type { MouseEvent, isFlashMouseEvent } from "../../src/layaAir/flash/events/MouseEvent.ts";
import type { ProgressEvent, isFlashProgressEvent } from "../../src/layaAir/flash/events/ProgressEvent.ts";
import type { SecurityErrorEvent, isFlashSecurityErrorEvent } from "../../src/layaAir/flash/events/SecurityErrorEvent.ts";
import type { TextEvent, isFlashTextEvent } from "../../src/layaAir/flash/events/TextEvent.ts";
import type { TimerEvent, isFlashTimerEvent } from "../../src/layaAir/flash/events/TimerEvent.ts";
import type { UncaughtErrorEvent, isFlashUncaughtErrorEvent } from "../../src/layaAir/flash/events/UncaughtErrorEvent.ts";
import type { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError.ts";

test("Flash events bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof Event, typeof EventPhase, typeof EventDispatcher, typeof FlashEventRouter,
        typeof ContextMenuEvent, typeof ErrorEvent, typeof FocusEvent, typeof HTTPStatusEvent, typeof IMEEvent,
        typeof IOErrorEvent, typeof KeyboardEvent, typeof MouseEvent, typeof ProgressEvent, typeof SecurityErrorEvent,
        typeof TextEvent, typeof TimerEvent, typeof UncaughtErrorEvent,
        typeof isFlashEvent, typeof isFlashEventDispatcher, typeof isFlashErrorEvent, typeof isFlashFocusEvent,
        typeof isFlashContextMenuEvent, typeof isFlashHTTPStatusEvent, typeof isFlashIOErrorEvent,
        typeof isFlashKeyboardEvent, typeof isFlashMouseEvent, typeof isFlashProgressEvent,
        typeof isFlashSecurityErrorEvent, typeof isFlashTextEvent, typeof isFlashTimerEvent,
        typeof isFlashUncaughtErrorEvent,
        IEventDispatcher, FlashEventListener, NativeEventHost,
        typeof UnsupportedFlashFeatureError] extends readonly unknown[] ? boolean : never));
});
