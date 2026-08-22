import assert from "node:assert/strict";
import test from "node:test";

import type { SoundChannel as LayaSoundChannel } from "../../src/layaAir/laya/media/SoundChannel";
import { SoundManager } from "../../src/layaAir/laya/media/SoundManager";
import { Event } from "../../src/layaAir/flash/events/Event";
import { Sound, isFlashSound } from "../../src/layaAir/flash/media/Sound";
import { isFlashSoundChannel } from "../../src/layaAir/flash/media/SoundChannel";
import {
    SoundLoaderContext, isFlashSoundLoaderContext,
} from "../../src/layaAir/flash/media/SoundLoaderContext";
import { SoundTransform } from "../../src/layaAir/flash/media/SoundTransform";
import { URLRequest } from "../../src/layaAir/flash/net/URLRequest";

interface NativeProbe {
    position: number;
    volume: number;
    pan: number;
    stopped: number;
    stop(): void;
}

test("sound loading contexts retain exact Flash defaults and nominal admission", () => {
    const defaults = new SoundLoaderContext();
    const configured = new SoundLoaderContext(3000, true);
    assert.deepEqual([defaults.bufferTime, defaults.checkPolicyFile], [1000, false]);
    assert.deepEqual([configured.bufferTime, configured.checkPolicyFile], [3000, true]);
    assert.equal(isFlashSoundLoaderContext(configured), true);
    assert.equal(isFlashSoundLoaderContext({ bufferTime: 3000, checkPolicyFile: true }), false);
    assert.throws(
        () => new Sound(new URLRequest("music.mp3"), {} as SoundLoaderContext),
        /canonical SoundLoaderContext/,
    );
});

test("sound transforms snapshot all six source-visible mix values", () => {
    const transform = new SoundTransform(0.75, -0.25);
    transform.leftToLeft = 0.9;
    transform.leftToRight = 0.1;
    transform.rightToLeft = 0.2;
    transform.rightToRight = 0.8;
    const copy = SoundTransform.copy(transform);
    assert.notEqual(copy, transform);
    assert.deepEqual(
        [copy.volume, copy.pan, copy.leftToLeft, copy.leftToRight, copy.rightToLeft, copy.rightToRight],
        [0.75, -0.25, 0.9, 0.1, 0.2, 0.8],
    );
    transform.volume = 0;
    assert.equal(copy.volume, 0.75);
    assert.throws(() => SoundTransform.copy({} as SoundTransform), /canonical SoundTransform/);
});

test("Sound maps Flash milliseconds, additional loops, transforms, stop, and completion", () => {
    const original = SoundManager.playSound;
    const calls: unknown[][] = [];
    const native: NativeProbe = {
        position: 4.25,
        volume: 1,
        pan: 0,
        stopped: 0,
        stop(): void { this.stopped++; },
    };
    let complete: ((success?: boolean) => void) | null = null;
    SoundManager.playSound = ((...args: unknown[]) => {
        calls.push(args);
        complete = args[2] as (success?: boolean) => void;
        return native as unknown as LayaSoundChannel;
    }) as typeof SoundManager.playSound;
    try {
        const sound = new Sound(
            new URLRequest("Resources/Sound/battle.mp3"),
            new SoundLoaderContext(3000, true),
        );
        assert.equal(isFlashSound(sound), true);
        assert.equal(sound.url, "Resources/Sound/battle.mp3");
        const channel = sound.play(2500, 2, new SoundTransform(0.6, -0.4));
        assert.ok(channel);
        assert.equal(isFlashSoundChannel(channel), true);
        assert.deepEqual(calls[0].slice(0, 2), ["Resources/Sound/battle.mp3", 3]);
        assert.equal(calls[0][3], 2.5);
        assert.deepEqual([native.volume, native.pan, channel.position], [0.6, -0.4, 4250]);

        const seen: Event[] = [];
        channel.addEventListener(Event.SOUND_COMPLETE, event => seen.push(event));
        assert.ok(complete);
        complete(false);
        complete(true);
        complete(true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].target, channel);
        assert.equal(seen[0].currentTarget, channel);

        const snapshot = channel.soundTransform;
        snapshot.volume = 0.1;
        assert.equal(channel.soundTransform.volume, 0.6);
        channel.soundTransform = new SoundTransform(0.3, 0.2);
        assert.deepEqual([native.volume, native.pan], [0.3, 0.2]);
        channel.stop();
        assert.equal(native.stopped, 1);
    } finally {
        SoundManager.playSound = original;
    }
});

test("unloaded sounds return null without touching the native backend", () => {
    const original = SoundManager.playSound;
    let calls = 0;
    SoundManager.playSound = ((..._args: unknown[]) => {
        calls++;
        return null;
    }) as typeof SoundManager.playSound;
    try {
        const sound = new Sound();
        assert.equal(sound.play(), null);
        assert.equal(calls, 0);
        sound.load(new URLRequest("effect.wav"));
        assert.equal(sound.play(), null);
        assert.equal(calls, 1);
    } finally {
        SoundManager.playSound = original;
    }
});
