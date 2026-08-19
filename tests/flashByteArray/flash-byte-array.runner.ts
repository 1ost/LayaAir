import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { OutOfRangeError } from "../../src/layaAir/laya/utils/Error";
import { ByteArray, ZlibDecompressionHost } from "../../src/layaAir/flash/utils/ByteArray";
import { Endian } from "../../src/layaAir/flash/utils/Endian";

function bytesOf(value: ByteArray): number[] {
    return [...new Uint8Array(value.buffer)];
}

test("ByteArray defaults to big endian and round-trips both byte orders", () => {
    const bytes = new ByteArray();
    assert.equal(bytes.endian, Endian.BIG_ENDIAN);
    bytes.writeShort(0x1234);
    bytes.writeUnsignedInt(0x89abcdef);
    assert.deepEqual(bytesOf(bytes), [0x12, 0x34, 0x89, 0xab, 0xcd, 0xef]);
    bytes.position = 0;
    assert.equal(bytes.readUnsignedShort(), 0x1234);
    assert.equal(bytes.readUnsignedInt(), 0x89abcdef);

    bytes.clear();
    bytes.endian = Endian.LITTLE_ENDIAN;
    bytes.writeShort(0x1234);
    bytes.writeUnsignedInt(0x89abcdef);
    assert.deepEqual(bytesOf(bytes), [0x34, 0x12, 0xef, 0xcd, 0xab, 0x89]);
    bytes.position = 0;
    assert.equal(bytes.readUnsignedShort(), 0x1234);
    assert.equal(bytes.readUnsignedInt(), 0x89abcdef);
    assert.throws(() => { bytes.endian = "middleEndian"; }, RangeError);
    assert.equal(bytes.endian, Endian.LITTLE_ENDIAN, "invalid endian must not mutate state");
});

test("cursor failures are stable and bytesAvailable never becomes negative", () => {
    const bytes = new ByteArray(new Uint8Array([1, 2, 3]));
    bytes.position = 3;
    assert.throws(() => bytes.readUnsignedByte(), OutOfRangeError);
    assert.deepEqual([bytes.position, bytes.bytesAvailable], [3, 0]);
    bytes.position = 99;
    assert.deepEqual([bytes.length, bytes.position, bytes.bytesAvailable], [3, 99, 0]);
    bytes.length = 5;
    assert.deepEqual([bytes.length, bytes.position, bytes.bytesAvailable], [5, 5, 0]);
    bytes.position = 3;
    assert.deepEqual([bytes.readUnsignedByte(), bytes.readUnsignedByte()], [0, 0]);
    bytes.length = 1;
    assert.deepEqual([bytes.length, bytes.position, bytes.bytesAvailable], [1, 1, 0]);
    assert.throws(() => bytes.readUnsignedShort(), OutOfRangeError);
    assert.equal(bytes.position, 1);
    assert.throws(() => { bytes.position = -1; }, RangeError);
    assert.throws(() => { bytes.length = 1.5; }, RangeError);
});

test("UTF-8 and unsigned bytes preserve exact cursor movement", () => {
    const bytes = new ByteArray();
    bytes.writeByte(-1);
    bytes.writeUTFBytes("Bleach 黒崎 🐻");
    const length = bytes.length - 1;
    bytes.position = 0;
    assert.equal(bytes.readUnsignedByte(), 255);
    assert.equal(bytes.readUTFBytes(length), "Bleach 黒崎 🐻");
    assert.equal(bytes.bytesAvailable, 0);
    bytes.position = 1;
    assert.throws(() => bytes.readUTFBytes(length + 1), OutOfRangeError);
    assert.equal(bytes.position, 1);
});

test("readUTFBytes preserves NUL and never overreads a truncated multibyte slice", () => {
    const nul = new ByteArray(new Uint8Array([0x41, 0x00, 0x42]));
    assert.equal(nul.readUTFBytes(3), "A\0B");
    assert.deepEqual([nul.position, nul.bytesAvailable], [3, 0]);

    const truncated = new ByteArray(new Uint8Array([0xe2, 0x82, 0x41]));
    assert.equal(truncated.readUTFBytes(2), "\ufffd");
    assert.deepEqual([truncated.position, truncated.bytesAvailable], [2, 1]);
    assert.equal(truncated.readUTFBytes(1), "A");
    assert.equal(truncated.position, 3);

    truncated.position = 2;
    assert.throws(() => truncated.readUTFBytes(2), OutOfRangeError);
    assert.equal(truncated.position, 2, "out-of-range UTF reads must not move the cursor");
});

test("constructor and buffer getter both have a copy policy", () => {
    const source = new Uint8Array([9, 8, 7, 6]);
    const bytes = new ByteArray(source.subarray(1, 3));
    source[1] = 99;
    assert.deepEqual(bytesOf(bytes), [8, 7]);
    const exposed = new Uint8Array(bytes.buffer);
    exposed[0] = 44;
    assert.deepEqual(bytesOf(bytes), [8, 7]);
    bytes.position = bytes.length;
    bytes.writeByte(6);
    assert.deepEqual(bytesOf(bytes), [8, 7, 6], "copied input must retain Laya Byte growth semantics");
});

test("the default browser host decodes a zlib-wrapped version manifest atomically", async () => {
    const manifest = new ByteArray();
    manifest.endian = Endian.LITTLE_ENDIAN;
    manifest.writeShort(1);
    manifest.writeShort(16);
    manifest.writeUTFBytes("TApplication.swf");
    manifest.writeShort(10);
    manifest.writeUTFBytes("2013070522");
    const compressed = new ByteArray(deflateSync(new Uint8Array(manifest.buffer)));
    compressed.endian = Endian.LITTLE_ENDIAN;
    await compressed.uncompressZlib();
    assert.equal(compressed.position, 0);
    assert.equal(compressed.endian, Endian.LITTLE_ENDIAN);
    assert.equal(compressed.readUnsignedShort(), 1);
    assert.equal(compressed.readUTFBytes(compressed.readUnsignedShort()), "TApplication.swf");
    assert.equal(compressed.readUTFBytes(compressed.readUnsignedShort()), "2013070522");
});

test("malformed zlib and host failures leave the receiver unchanged", async () => {
    const malformed = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    malformed.position = 2;
    await assert.rejects(malformed.uncompressZlib());
    assert.deepEqual([bytesOf(malformed), malformed.position], [[1, 2, 3, 4], 2]);

    const expected = new Error("host failed");
    const failing: ZlibDecompressionHost = {
        async decompressZlib(): Promise<ArrayBuffer> { throw expected; }
    };
    await assert.rejects(malformed.uncompressZlib(failing), error => error === expected);
    assert.deepEqual([bytesOf(malformed), malformed.position], [[1, 2, 3, 4], 2]);
});

test("cancellation is forwarded and cannot partially commit output", async () => {
    const controller = new AbortController();
    const bytes = new ByteArray(new Uint8Array([5, 6, 7]));
    let observedSignal: AbortSignal | undefined;
    const host: ZlibDecompressionHost = {
        decompressZlib(_input, signal): Promise<ArrayBuffer> {
            observedSignal = signal;
            return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
        }
    };
    const pending = bytes.uncompressZlib(host, controller.signal);
    controller.abort(new DOMException("cancelled", "AbortError"));
    await assert.rejects(pending, error => error === controller.signal.reason);
    assert.equal(observedSignal, controller.signal);
    assert.deepEqual(bytesOf(bytes), [5, 6, 7]);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    let called = false;
    await assert.rejects(bytes.uncompressZlib({
        async decompressZlib(): Promise<ArrayBuffer> { called = true; return new ArrayBuffer(0); }
    }, alreadyAborted.signal), error => (error as DOMException).name === "AbortError");
    assert.equal(called, false);

    const lateAbort = new AbortController();
    const late = bytes.uncompressZlib({
        async decompressZlib(): Promise<ArrayBuffer> {
            queueMicrotask(() => lateAbort.abort(new DOMException("late cancel", "AbortError")));
            return new Uint8Array([9, 9]).buffer;
        }
    }, lateAbort.signal);
    await assert.rejects(late, error => error === lateAbort.signal.reason);
    assert.deepEqual(bytesOf(bytes), [5, 6, 7]);
});

test("a reverse-completion overlap cannot race for last completion", async () => {
    const bytes = new ByteArray(new Uint8Array([1, 2, 3]));
    let finishFirst!: (value: ArrayBuffer) => void;
    const firstHost: ZlibDecompressionHost = {
        decompressZlib(): Promise<ArrayBuffer> {
            return new Promise(resolve => { finishFirst = resolve; });
        }
    };
    let finishOverlapping: ((value: ArrayBuffer) => void) | undefined;
    const first = bytes.uncompressZlib(firstHost);
    await assert.rejects(bytes.uncompressZlib({
        decompressZlib(): Promise<ArrayBuffer> {
            return new Promise(resolve => { finishOverlapping = resolve; });
        }
    }), /already in progress/);
    assert.equal(finishOverlapping, undefined, "the later host must not acquire completion ownership");
    assert.deepEqual(bytesOf(bytes), [1, 2, 3]);

    finishFirst(new Uint8Array([4, 5]).buffer);
    await first;
    assert.deepEqual(bytesOf(bytes), [4, 5]);
    await bytes.uncompressZlib({
        async decompressZlib(): Promise<ArrayBuffer> { return new Uint8Array([6]).buffer; }
    });
    assert.deepEqual(bytesOf(bytes), [6], "ownership must release after completion");
});

test("receiver mutation invalidates an older decompression commit", async () => {
    const bytes = new ByteArray(new Uint8Array([1, 2, 3]));
    let finish!: (value: ArrayBuffer) => void;
    const pending = bytes.uncompressZlib({
        decompressZlib(): Promise<ArrayBuffer> {
            return new Promise(resolve => { finish = resolve; });
        }
    });
    bytes.position = bytes.length;
    bytes.writeByte(9);
    finish(new Uint8Array([4, 5]).buffer);
    await assert.rejects(pending, /mutated while zlib decompression was in progress/);
    assert.deepEqual([bytesOf(bytes), bytes.position], [[1, 2, 3, 9], 4]);

    await bytes.uncompressZlib({
        async decompressZlib(): Promise<ArrayBuffer> { return new Uint8Array([7]).buffer; }
    });
    assert.deepEqual(bytesOf(bytes), [7], "failed stale ownership must release for a later operation");
});
