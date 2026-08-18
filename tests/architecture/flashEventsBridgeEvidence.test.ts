import assert from "node:assert/strict";
import test from "node:test";
import type { Event, EventPhase } from "../../src/layaAir/flash/events/Event.ts";
import type { EventDispatcher } from "../../src/layaAir/flash/events/EventDispatcher.ts";
import type { ErrorEvent } from "../../src/layaAir/flash/events/ErrorEvent.ts";
import type { FocusEvent } from "../../src/layaAir/flash/events/FocusEvent.ts";
import type { FlashEventRouter } from "../../src/layaAir/flash/events/FlashEventRouter.ts";
import type { IMEEvent } from "../../src/layaAir/flash/events/IMEEvent.ts";
import type { IOErrorEvent } from "../../src/layaAir/flash/events/IOErrorEvent.ts";
import type { KeyboardEvent } from "../../src/layaAir/flash/events/KeyboardEvent.ts";
import type { MouseEvent } from "../../src/layaAir/flash/events/MouseEvent.ts";
import type { TextEvent } from "../../src/layaAir/flash/events/TextEvent.ts";
import type { TimerEvent } from "../../src/layaAir/flash/events/TimerEvent.ts";
import type { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError.ts";

test("Flash events bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof Event, typeof EventPhase, typeof EventDispatcher, typeof FlashEventRouter,
        typeof ErrorEvent, typeof FocusEvent, typeof IMEEvent, typeof IOErrorEvent, typeof KeyboardEvent,
        typeof MouseEvent, typeof TextEvent, typeof TimerEvent,
        typeof UnsupportedFlashFeatureError] extends readonly unknown[] ? boolean : never));
});
