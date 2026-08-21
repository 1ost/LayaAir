import { Byte } from "../../laya/utils/Byte";
import { OutOfRangeError } from "../../laya/utils/Error";
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

function checkedRangeEnd(start: number, length: number, label: string): number {
    if (length > 0xffffffff - start)
        throw new RangeError(`${label} exceeds the maximum ByteArray length`);
    return start + length;
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
 * synchronous zlib primitive. The default host rejects when the Web
 * DecompressionStream API is absent; callers may explicitly inject another
 * host, but the bridge never selects a silent fallback.
 */
export class ByteArray {
    private _bytes: Byte;
    private _decompressing = false;
    private _mutationGeneration = 0;

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
        if (length === this._bytes.length) return;
        this._bytes.length = length;
        if (this._bytes.pos > length) this._bytes.pos = length;
        this._mutationGeneration++;
    }

    get bytesAvailable(): number {
        return Math.max(0, this._bytes.length - this._bytes.pos);
    }

    get position(): number {
        return this._bytes.pos;
    }

    set position(value: number) {
        const position = checkedIndex(value, "ByteArray.position");
        if (position === this._bytes.pos) return;
        this._bytes.pos = position;
        this._mutationGeneration++;
    }

    get endian(): string {
        return this._bytes.endian;
    }

    set endian(value: string) {
        if (value !== Endian.BIG_ENDIAN && value !== Endian.LITTLE_ENDIAN)
            throw new RangeError(`Unsupported ByteArray endian: ${String(value)}`);
        if (value === this._bytes.endian) return;
        this._bytes.endian = value;
        this._mutationGeneration++;
    }

    clear(): void {
        if (this._bytes.length === 0 && this._bytes.pos === 0) return;
        this._bytes.clear();
        this._mutationGeneration++;
    }

    readUnsignedByte(): number {
        const value = this._bytes.readUint8();
        this._mutationGeneration++;
        return value;
    }

    readUnsignedShort(): number {
        const value = this._bytes.readUint16();
        this._mutationGeneration++;
        return value;
    }

    readUnsignedInt(): number {
        const value = this._bytes.readUint32();
        this._mutationGeneration++;
        return value;
    }

    readInt(): number {
        const value = this._bytes.readInt32();
        this._mutationGeneration++;
        return value;
    }

    readUTF(): string {
        const start = this._bytes.pos;
        try {
            const value = this._bytes.readUTFString();
            this._mutationGeneration++;
            return value;
        } catch (error) {
            this._bytes.pos = start;
            throw error;
        }
    }

    /**
     * Reads bytes from the current cursor into `bytes` at `offset`. A zero
     * length consumes all remaining bytes. A distinct destination's cursor is
     * not changed; a self-read finishes at the receiver's consumed position.
     */
    readBytes(bytes: ByteArray, offset = 0, length = 0): void {
        if (!(bytes instanceof ByteArray))
            throw new TypeError("ByteArray.readBytes requires a ByteArray");
        const targetOffset = checkedIndex(offset, "ByteArray.readBytes offset");
        const exactLength = length === 0
            ? this.bytesAvailable
            : checkedIndex(length, "ByteArray.readBytes length");
        const sourcePosition = this._bytes.pos;
        if (exactLength > this.bytesAvailable)
            throw new OutOfRangeError(sourcePosition + exactLength);
        if (exactLength === 0) return;
        checkedRangeEnd(targetOffset, exactLength, "ByteArray.readBytes range");

        const snapshot = new Uint8Array(this._bytes.buffer, sourcePosition, exactLength).slice();
        if (bytes === this) {
            this._bytes.pos = targetOffset;
            this._bytes.writeArrayBuffer(snapshot.buffer);
            this._bytes.pos = sourcePosition + exactLength;
            this._mutationGeneration++;
            return;
        }

        const targetPosition = bytes._bytes.pos;
        bytes._bytes.pos = targetOffset;
        bytes._bytes.writeArrayBuffer(snapshot.buffer);
        bytes._bytes.pos = targetPosition;
        bytes._mutationGeneration++;
        this._bytes.pos = sourcePosition + exactLength;
        this._mutationGeneration++;
    }

    /**
     * Decodes exactly `length` bytes with the WHATWG UTF-8 replacement policy.
     * NUL is preserved. Truncated or malformed sequences become U+FFFD and do
     * not consume bytes beyond the requested slice.
     */
    readUTFBytes(length: number = this.bytesAvailable): string {
        const exactLength = checkedIndex(length, "ByteArray.readUTFBytes length");
        const start = this._bytes.pos;
        if (exactLength > this.bytesAvailable)
            throw new OutOfRangeError(start + exactLength);
        if (exactLength === 0) return "";
        const source = new Uint8Array(this._bytes.buffer, start, exactLength);
        const value = new TextDecoder("utf-8", { fatal: false }).decode(source);
        this._bytes.pos = start + exactLength;
        this._mutationGeneration++;
        return value;
    }

    writeByte(value: number): void {
        this._bytes.writeByte(value);
        this._mutationGeneration++;
    }

    /**
     * Writes bytes from `bytes` into the receiver at its current cursor. A
     * zero length selects the source remainder; out-of-range source spans are
     * clamped to the source end. The source cursor is never changed.
     */
    writeBytes(bytes: ByteArray, offset = 0, length = 0): void {
        if (!(bytes instanceof ByteArray))
            throw new TypeError("ByteArray.writeBytes requires a ByteArray");
        const exactOffset = checkedIndex(offset, "ByteArray.writeBytes offset");
        const requestedLength = checkedIndex(length, "ByteArray.writeBytes length");
        const sourceOffset = Math.min(exactOffset, bytes.length);
        const available = bytes.length - sourceOffset;
        const exactLength = requestedLength === 0
            ? available
            : Math.min(requestedLength, available);
        if (exactLength === 0) return;
        checkedRangeEnd(this._bytes.pos, exactLength, "ByteArray.writeBytes range");

        const snapshot = new Uint8Array(bytes._bytes.buffer, sourceOffset, exactLength).slice();
        this._bytes.writeArrayBuffer(snapshot.buffer);
        this._mutationGeneration++;
    }

    writeShort(value: number): void {
        this._bytes.writeInt16(value);
        this._mutationGeneration++;
    }

    writeInt(value: number): void {
        this._bytes.writeInt32(value);
        this._mutationGeneration++;
    }

    writeUnsignedInt(value: number): void {
        this._bytes.writeUint32(value);
        this._mutationGeneration++;
    }

    writeUTFBytes(value: string): void {
        const start = this._bytes.pos;
        this._bytes.writeUTFBytes(value);
        if (this._bytes.pos !== start) this._mutationGeneration++;
    }

    writeUTF(value: string): void {
        const encoded = new Byte();
        encoded.writeUTFBytes(value);
        if (encoded.length > 0xffff)
            throw new RangeError("ByteArray.writeUTF encoded value exceeds 65535 bytes");
        this._bytes.writeUint16(encoded.length);
        if (encoded.length > 0)
            this._bytes.writeArrayBuffer(encoded.buffer.slice(0, encoded.length));
        this._mutationGeneration++;
    }

    /**
     * Atomically replaces this instance with zlib-decoded bytes. The receiver
     * is unchanged on host failure, malformed data, or cancellation. Only one
     * decompression may own an instance at a time; overlapping calls reject
     * before invoking their host instead of racing for last-completion-wins.
     * Any intervening cursor, endian, length, read, or write mutation
     * invalidates the older operation before it can commit.
     */
    async uncompressZlib(host: ZlibDecompressionHost = WEB_ZLIB_HOST, signal?: AbortSignal): Promise<void> {
        if (this._decompressing)
            throw new Error("ByteArray zlib decompression is already in progress");
        if (!host || typeof host.decompressZlib !== "function")
            throw new TypeError("A ZlibDecompressionHost is required");
        this._decompressing = true;
        const generation = this._mutationGeneration;
        try {
            throwIfAborted(signal);
            const compressed = new Uint8Array(this.buffer);
            let output: ByteArrayInput;
            try {
                output = await host.decompressZlib(compressed, signal);
            } catch (error) {
                throwIfAborted(signal);
                throw error;
            }
            throwIfAborted(signal);
            if (this._mutationGeneration !== generation)
                throw new Error("ByteArray mutated while zlib decompression was in progress");
            const replacement = new ByteArray(copyInput(output));
            replacement.endian = this.endian;
            this._bytes = replacement._bytes;
            this._mutationGeneration++;
        } finally {
            this._decompressing = false;
        }
    }
}
