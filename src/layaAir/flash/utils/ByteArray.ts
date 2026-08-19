import { Byte } from "../../laya/utils/Byte";
import { Endian } from "./Endian";

export type ByteArrayInput = ArrayBufferLike | ArrayBufferView;

/**
 * Host boundary for zlib-wrapped data. Implementations must reject malformed
 * input and must observe the supplied abort signal.
 */
export interface ZlibDecompressionHost {
    decompressZlib(input: Uint8Array, signal?: AbortSignal): Promise<ByteArrayInput>;
}

function checkedIndex(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
        throw new RangeError(`${label} must be an integer between 0 and 4294967295`);
    return value;
}

function copyInput(input: ByteArrayInput): ArrayBuffer {
    const source = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
    return source.slice().buffer;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

const WEB_ZLIB_HOST: ZlibDecompressionHost = Object.freeze({
    async decompressZlib(input: Uint8Array, signal?: AbortSignal): Promise<ArrayBuffer> {
        throwIfAborted(signal);
        if (typeof globalThis.DecompressionStream !== "function")
            throw new Error("The host does not provide the Web DecompressionStream API");
        const stream = new Blob([input]).stream()
            .pipeThrough(new DecompressionStream("deflate"), { signal });
        return new Response(stream).arrayBuffer();
    }
});

/**
 * Launch-oriented Flash ByteArray bridge backed by Laya's native Byte utility.
 *
 * The constructor and `buffer` getter always copy. Callers cannot mutate the
 * bridge through an input view or a returned ArrayBuffer. Compression is an
 * explicit asynchronous host boundary because browsers have no truthful
 * synchronous zlib primitive.
 */
export class ByteArray {
    private _bytes: Byte;

    constructor(input?: ByteArrayInput) {
        this._bytes = new Byte();
        if (input !== undefined) {
            this._bytes.writeArrayBuffer(copyInput(input));
            this._bytes.pos = 0;
        }
        this._bytes.endian = Endian.BIG_ENDIAN;
    }

    get buffer(): ArrayBuffer {
        return this._bytes.buffer.slice(0);
    }

    get length(): number {
        return this._bytes.length;
    }

    set length(value: number) {
        const length = checkedIndex(value, "ByteArray.length");
        this._bytes.length = length;
        if (this._bytes.pos > length) this._bytes.pos = length;
    }

    get bytesAvailable(): number {
        return Math.max(0, this._bytes.length - this._bytes.pos);
    }

    get position(): number {
        return this._bytes.pos;
    }

    set position(value: number) {
        this._bytes.pos = checkedIndex(value, "ByteArray.position");
    }

    get endian(): string {
        return this._bytes.endian;
    }

    set endian(value: string) {
        if (value !== Endian.BIG_ENDIAN && value !== Endian.LITTLE_ENDIAN)
            throw new RangeError(`Unsupported ByteArray endian: ${String(value)}`);
        this._bytes.endian = value;
    }

    clear(): void {
        this._bytes.clear();
    }

    readUnsignedByte(): number {
        return this._bytes.readUint8();
    }

    readUnsignedShort(): number {
        return this._bytes.readUint16();
    }

    readUnsignedInt(): number {
        return this._bytes.readUint32();
    }

    readUTFBytes(length: number = this.bytesAvailable): string {
        const exactLength = checkedIndex(length, "ByteArray.readUTFBytes length");
        return this._bytes.readUTFBytes(exactLength);
    }

    writeByte(value: number): void {
        this._bytes.writeByte(value);
    }

    writeShort(value: number): void {
        this._bytes.writeInt16(value);
    }

    writeUnsignedInt(value: number): void {
        this._bytes.writeUint32(value);
    }

    writeUTFBytes(value: string): void {
        this._bytes.writeUTFBytes(value);
    }

    /**
     * Atomically replaces this instance with zlib-decoded bytes. The receiver
     * is unchanged on host failure, malformed data, or cancellation.
     */
    async uncompressZlib(host: ZlibDecompressionHost = WEB_ZLIB_HOST, signal?: AbortSignal): Promise<void> {
        if (!host || typeof host.decompressZlib !== "function")
            throw new TypeError("A ZlibDecompressionHost is required");
        throwIfAborted(signal);
        const compressed = new Uint8Array(this.buffer);
        const output = await host.decompressZlib(compressed, signal);
        throwIfAborted(signal);
        const replacement = new ByteArray(copyInput(output));
        replacement.endian = this.endian;
        this._bytes = replacement._bytes;
    }
}
