import assert from "node:assert/strict";
import test from "node:test";
import { constants, deflateSync } from "node:zlib";
import { OutOfRangeError } from "../../src/layaAir/laya/utils/Error";
import { ByteArray, ZlibDecompressionHost } from "../../src/layaAir/flash/utils/ByteArray";
import { Endian } from "../../src/layaAir/flash/utils/Endian";
import { Dictionary } from "../../src/layaAir/flash/utils/Dictionary";
import { registerClassAlias } from "../../src/layaAir/flash/net/ClassAlias";

function bytesOf(value: ByteArray): number[] {
    return [...new Uint8Array(value.buffer)];
}

test("ByteArray object I/O preserves graphs, native values, and registered class identity", () => {
    class Example {
        value = 0;
    }
    registerClassAlias("tests::Example", Example);
    const instance = new Example();
    instance.value = 42;
    const source: Record<string, unknown> = {
        instance,
        values: [undefined, NaN, Infinity, -Infinity, -0],
        when: new Date(123456789),
    };
    source.self = source;

    const bytes = new ByteArray();
    bytes.writeObject(source);
    const firstEncoding = bytesOf(bytes);
    bytes.position = 0;
    const decoded = bytes.readObject() as typeof source;
    assert.notEqual(decoded, source);
    assert.equal(decoded.self, decoded);
    assert.ok(decoded.instance instanceof Example);
    assert.equal((decoded.instance as Example).value, 42);
    assert.deepEqual((decoded.values as unknown[]).slice(0, 4), [undefined, NaN, Infinity, -Infinity]);
    assert.ok(Object.is((decoded.values as unknown[])[4], -0));
    assert.equal((decoded.when as Date).getTime(), 123456789);
    assert.equal(bytes.bytesAvailable, 0);

    const repeated = new ByteArray();
    repeated.writeObject(source);
    assert.deepEqual(bytesOf(repeated), firstEncoding, "the same graph must encode deterministically");
});

test("ByteArray object reads fail atomically for truncated or malformed payloads", () => {
    const truncated = new ByteArray(new Uint8Array([0, 0, 0, 4, 1, 2]));
    assert.throws(() => truncated.readObject(), OutOfRangeError);
    assert.equal(truncated.position, 0);

    const malformed = new ByteArray(new Uint8Array([0, 0, 0, 2, 0xff, 0xff]));
    assert.throws(() => malformed.readObject(), TypeError);
    assert.equal(malformed.position, 0);
});

test("Dictionary preserves key identity, ordering, updates, deletion, and weak-key admission", () => {
    const first = {};
    const second = {};
    const dictionary = new Dictionary<object | string, number>();
    dictionary.set(first, 1).set("named", 2).set(second, 3).set(first, 4);
    assert.deepEqual([...dictionary.entries()], [[first, 4], ["named", 2], [second, 3]]);
    assert.equal(dictionary.size, 3);
    assert.equal(dictionary.get({}), undefined);
    assert.equal(dictionary.delete("named"), true);
    assert.equal(dictionary.delete("named"), false);
    assert.deepEqual([...dictionary.keys()], [first, second]);
    dictionary.clear();
    assert.equal(dictionary.size, 0);

    const weak = new Dictionary<object | number, string>(true);
    weak.set(first, "object").set(7, "primitive");
    assert.equal(weak.weakKeys, true);
    assert.deepEqual([...weak.values()], ["object", "primitive"]);
    assert.equal(weak.get(first), "object");
});

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

test("readShort preserves signed 16-bit values in both byte orders", () => {
    for (const endian of [Endian.BIG_ENDIAN, Endian.LITTLE_ENDIAN]) {
        const bytes = new ByteArray();
        bytes.endian = endian;
        bytes.writeShort(-0x8000);
        bytes.writeShort(-1);
        bytes.writeShort(0x7fff);
        bytes.position = 0;
        assert.deepEqual(
            [bytes.readShort(), bytes.readShort(), bytes.readShort()],
            [-0x8000, -1, 0x7fff],
        );
        assert.throws(() => bytes.readShort(), OutOfRangeError);
        assert.equal(bytes.position, bytes.length, "a failed signed-short read must not advance");
    }
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

test("readByte preserves signed byte values and cursor failure semantics", () => {
    const bytes = new ByteArray(new Uint8Array([0x00, 0x7f, 0x80, 0xff]));
    assert.deepEqual(
        [bytes.readByte(), bytes.readByte(), bytes.readByte(), bytes.readByte()],
        [0, 127, -128, -1],
    );
    assert.deepEqual([bytes.position, bytes.bytesAvailable], [4, 0]);
    assert.throws(() => bytes.readByte(), OutOfRangeError);
    assert.equal(bytes.position, 4, "a failed signed-byte read must not advance the cursor");
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

test("double values preserve IEEE-754 bytes, endian, cursor, and special numbers", () => {
    const bytes = new ByteArray();
    bytes.writeDouble(Math.PI);
    assert.deepEqual(bytesOf(bytes), [0x40, 0x09, 0x21, 0xfb, 0x54, 0x44, 0x2d, 0x18]);
    bytes.position = 0;
    assert.equal(bytes.readDouble(), Math.PI);
    assert.deepEqual([bytes.position, bytes.bytesAvailable], [8, 0]);

    bytes.clear();
    bytes.endian = Endian.LITTLE_ENDIAN;
    bytes.writeDouble(Math.PI);
    assert.deepEqual(bytesOf(bytes), [0x18, 0x2d, 0x44, 0x54, 0xfb, 0x21, 0x09, 0x40]);
    bytes.writeDouble(-0);
    bytes.writeDouble(Infinity);
    bytes.writeDouble(NaN);
    bytes.position = 0;
    assert.equal(bytes.readDouble(), Math.PI);
    assert.equal(Object.is(bytes.readDouble(), -0), true);
    assert.equal(bytes.readDouble(), Infinity);
    assert.equal(Number.isNaN(bytes.readDouble()), true);

    const truncated = new ByteArray(new Uint8Array(7));
    assert.throws(() => truncated.readDouble(), OutOfRangeError);
    assert.equal(truncated.position, 0, "a failed double read must not advance the cursor");
});

test("float values preserve IEEE-754 endian, cursor, and special numbers", () => {
    const big = new ByteArray(new Uint8Array([0x40, 0x49, 0x0f, 0xdb]));
    assert.equal(big.readFloat(), Math.fround(Math.PI));
    assert.deepEqual([big.position, big.bytesAvailable], [4, 0]);

    const little = new ByteArray(new Uint8Array([0xdb, 0x0f, 0x49, 0x40]));
    little.endian = Endian.LITTLE_ENDIAN;
    assert.equal(little.readFloat(), Math.fround(Math.PI));

    const special = new ByteArray(new Uint8Array([
        0x80, 0x00, 0x00, 0x00,
        0x7f, 0x80, 0x00, 0x00,
        0x7f, 0xc0, 0x00, 0x00,
    ]));
    assert.equal(Object.is(special.readFloat(), -0), true);
    assert.equal(special.readFloat(), Infinity);
    assert.equal(Number.isNaN(special.readFloat()), true);

    const truncated = new ByteArray(new Uint8Array(3));
    assert.throws(() => truncated.readFloat(), OutOfRangeError);
    assert.equal(truncated.position, 0, "a failed float read must not advance the cursor");
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

test("synchronous Flash uncompress decodes stored, fixed, and dynamic zlib blocks", () => {
    const fixtures = [
        new Uint8Array([0, 1, 2, 3, 4, 5, 0, 255]),
        new TextEncoder().encode("Bleach map ".repeat(64)),
        new Uint8Array(Array.from({ length: 4096 }, (_, index) => (index * 37 + (index >>> 3)) & 0xff)),
    ];
    const options = [
        { level: 0 },
        { level: 9, strategy: constants.Z_FIXED },
        { level: 6 },
    ];
    for (let index = 0; index < fixtures.length; index++) {
        const compressed = new ByteArray(deflateSync(fixtures[index], options[index]));
        compressed.endian = Endian.LITTLE_ENDIAN;
        compressed.position = compressed.length;
        compressed.uncompress();
        assert.deepEqual(bytesOf(compressed), [...fixtures[index]]);
        assert.equal(compressed.position, 0);
        assert.equal(compressed.endian, Endian.LITTLE_ENDIAN);
    }
});

test("synchronous Flash uncompress matches zlib across deterministic block shapes", () => {
    let state = 0x1badb002;
    const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
    for (let fixtureIndex = 0; fixtureIndex < 72; fixtureIndex++) {
        const length = fixtureIndex < 8 ? fixtureIndex : next() % 12000;
        const source = new Uint8Array(length);
        for (let index = 0; index < source.length; index++) {
            const selector = fixtureIndex % 4;
            source[index] = selector === 0 ? next() & 0xff
                : selector === 1 ? index & 7
                : selector === 2 ? (index >>> 5) & 0xff
                : (next() & 7) === 0 ? next() & 0xff : 65;
        }
        const level = fixtureIndex % 10;
        const strategy = fixtureIndex % 3 === 0 ? constants.Z_FIXED : constants.Z_DEFAULT_STRATEGY;
        const bytes = new ByteArray(deflateSync(source, { level, strategy }));
        bytes.uncompress();
        assert.deepEqual(bytesOf(bytes), [...source], `fixture ${fixtureIndex}, level ${level}`);
    }
});

test("synchronous Flash uncompress rejects malformed streams atomically", () => {
    const valid = new Uint8Array(deflateSync(new TextEncoder().encode("map payload")));
    const cases = [
        new Uint8Array([1, 2, 3]),
        valid.map((value, index) => index === 1 ? value ^ 1 : value),
        valid.map((value, index) => index === valid.length - 1 ? value ^ 1 : value),
        valid.slice(0, -2),
    ];
    for (const fixture of cases) {
        const bytes = new ByteArray(fixture);
        bytes.position = Math.min(2, bytes.length);
        const before = bytesOf(bytes);
        const position = bytes.position;
        assert.throws(() => bytes.uncompress(), TypeError);
        assert.deepEqual(bytesOf(bytes), before);
        assert.equal(bytes.position, position);
    }
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
