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

test("readBoolean consumes one byte and treats every nonzero value as true", () => {
    const bytes = new ByteArray(new Uint8Array([0, 1, 2, 255]));
    assert.deepEqual(
        [bytes.readBoolean(), bytes.readBoolean(), bytes.readBoolean(), bytes.readBoolean()],
        [false, true, true, true],
    );
    assert.deepEqual([bytes.position, bytes.bytesAvailable], [4, 0]);
    assert.throws(() => bytes.readBoolean(), OutOfRangeError);
    assert.equal(bytes.position, 4, "a failed Boolean read must not advance the cursor");
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

test("signed integers and length-prefixed UTF strings round-trip in both byte orders", () => {
    const bytes = new ByteArray();
    bytes.writeInt(-0x1234567);
    bytes.writeUTF("Squad \u9ed1\u5d0e \ud83d\udc3b");
    assert.deepEqual(bytesOf(bytes).slice(0, 4), [0xfe, 0xdc, 0xba, 0x99]);
    bytes.position = 0;
    assert.equal(bytes.readInt(), -0x1234567);
    assert.equal(bytes.readUTF(), "Squad \u9ed1\u5d0e \ud83d\udc3b");
    assert.equal(bytes.bytesAvailable, 0);

    bytes.clear();
    bytes.endian = Endian.LITTLE_ENDIAN;
    bytes.writeInt(-0x1234567);
    bytes.writeUTF("\u20ac");
    assert.deepEqual(bytesOf(bytes), [0x99, 0xba, 0xdc, 0xfe, 0x03, 0x00, 0xe2, 0x82, 0xac]);
    bytes.position = 0;
    assert.equal(bytes.readInt(), -0x1234567);
    assert.equal(bytes.readUTF(), "\u20ac");
});

test("length-prefixed UTF failures do not partially consume the stream", () => {
    const truncated = new ByteArray(new Uint8Array([0, 3, 0x41]));
    assert.throws(() => truncated.readUTF(), OutOfRangeError);
    assert.equal(truncated.position, 0, "the length prefix and payload form one failed read");

    const missingPrefix = new ByteArray(new Uint8Array([0]));
    assert.throws(() => missingPrefix.readUTF(), OutOfRangeError);
    assert.equal(missingPrefix.position, 0, "a missing length prefix must not advance the cursor");

    const oversized = new ByteArray(new Uint8Array([9, 8]));
    oversized.position = 1;
    assert.throws(() => oversized.writeUTF("a".repeat(0x10000)), RangeError);
    assert.deepEqual([bytesOf(oversized), oversized.position], [[9, 8], 1]);
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

test("readBytes transfers exact ranges, grows with zeros, and preserves the destination cursor", () => {
    const source = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    source.position = 1;
    const destination = new ByteArray(new Uint8Array([9]));
    destination.position = 1;

    source.readBytes(destination, 3);
    assert.deepEqual(bytesOf(destination), [9, 0, 0, 2, 3, 4]);
    assert.equal(destination.position, 1);
    assert.deepEqual([source.position, source.bytesAvailable], [4, 0]);

    const insufficient = new ByteArray(new Uint8Array([5, 6]));
    insufficient.position = 1;
    const unchanged = new ByteArray(new Uint8Array([7, 8]));
    unchanged.position = 2;
    assert.throws(() => insufficient.readBytes(unchanged, 4, 2), OutOfRangeError);
    assert.deepEqual([bytesOf(insufficient), insufficient.position], [[5, 6], 1]);
    assert.deepEqual([bytesOf(unchanged), unchanged.position], [[7, 8], 2]);
});

test("writeBytes clamps source ranges and preserves the source cursor", () => {
    const source = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    source.position = 2;
    const destination = new ByteArray(new Uint8Array([8]));
    destination.position = 1;

    destination.writeBytes(source, 2, 99);
    assert.deepEqual([bytesOf(destination), destination.position], [[8, 3, 4], 3]);
    assert.equal(source.position, 2);

    destination.writeBytes(source, 99);
    assert.deepEqual([bytesOf(destination), destination.position], [[8, 3, 4], 3]);
    assert.equal(source.position, 2);
});

test("self readBytes and writeBytes snapshot overlapping ranges", () => {
    const reading = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    reading.position = 1;
    reading.readBytes(reading, 0, 3);
    assert.deepEqual([bytesOf(reading), reading.position], [[2, 3, 4, 4], 4]);

    const writing = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    writing.position = 1;
    writing.writeBytes(writing, 0, 3);
    assert.deepEqual([bytesOf(writing), writing.position], [[1, 1, 2, 3], 4]);
});

test("byte transfer arguments fail before mutating either side", () => {
    const source = new ByteArray(new Uint8Array([1, 2, 3]));
    const destination = new ByteArray(new Uint8Array([4, 5]));
    assert.throws(() => source.readBytes(destination, -1), RangeError);
    assert.throws(() => destination.writeBytes(source, 0, 1.5), RangeError);
    assert.throws(() => source.readBytes({} as ByteArray), TypeError);
    assert.throws(() => destination.writeBytes({} as ByteArray), TypeError);
    assert.deepEqual([bytesOf(source), source.position], [[1, 2, 3], 0]);
    assert.deepEqual([bytesOf(destination), destination.position], [[4, 5], 0]);
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
