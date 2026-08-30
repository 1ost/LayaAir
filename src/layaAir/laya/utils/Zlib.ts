const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

class DeflateBitReader {
    private _offset = 0;
    private _bits = 0;
    private _bitCount = 0;

    constructor(private readonly _input: Uint8Array) {}

    readBits(count: number): number {
        if (count < 0 || count > 16) throw new RangeError("Invalid DEFLATE bit count");
        while (this._bitCount < count) {
            if (this._offset >= this._input.length) throw new TypeError("Truncated DEFLATE stream");
            this._bits |= this._input[this._offset++] << this._bitCount;
            this._bitCount += 8;
        }
        const mask = count === 16 ? 0xffff : (1 << count) - 1;
        const value = this._bits & mask;
        this._bits >>>= count;
        this._bitCount -= count;
        return value;
    }

    alignToByte(): void {
        const discarded = this._bitCount & 7;
        this._bits >>>= discarded;
        this._bitCount -= discarded;
    }

    readAlignedByte(): number {
        if (this._bitCount !== 0) throw new TypeError("DEFLATE reader is not byte-aligned");
        if (this._offset >= this._input.length) throw new TypeError("Truncated DEFLATE stream");
        return this._input[this._offset++];
    }

    finish(): void {
        if (this._offset !== this._input.length) throw new TypeError("Trailing bytes after DEFLATE stream");
    }
}

class InflateOutput {
    private _bytes = new Uint8Array(1024);
    private _length = 0;

    get length(): number { return this._length; }

    write(value: number): void {
        this.ensureCapacity(this._length + 1);
        this._bytes[this._length++] = value;
    }

    copy(distance: number, length: number): void {
        if (distance <= 0 || distance > this._length) throw new TypeError("Invalid DEFLATE back-reference");
        this.ensureCapacity(this._length + length);
        for (let index = 0; index < length; index++) {
            this._bytes[this._length] = this._bytes[this._length - distance];
            this._length++;
        }
    }

    finish(): Uint8Array { return this._bytes.slice(0, this._length); }

    private ensureCapacity(required: number): void {
        if (!Number.isSafeInteger(required) || required > 0xffffffff)
            throw new RangeError("Inflated ByteArray exceeds the maximum length");
        if (required <= this._bytes.length) return;
        let capacity = this._bytes.length;
        while (capacity < required) capacity = Math.min(0xffffffff, Math.max(required, capacity * 2));
        const replacement = new Uint8Array(capacity);
        replacement.set(this._bytes.subarray(0, this._length));
        this._bytes = replacement;
    }
}

interface HuffmanTable {
    readonly entries: ReadonlyMap<number, number>;
    readonly maximumLength: number;
}

function reverseBits(value: number, length: number): number {
    let reversed = 0;
    for (let bit = 0; bit < length; bit++) {
        reversed = (reversed << 1) | (value & 1);
        value >>>= 1;
    }
    return reversed;
}

function buildHuffmanTable(lengths: readonly number[]): HuffmanTable {
    const counts = new Array<number>(16).fill(0);
    let maximumLength = 0;
    for (const length of lengths) {
        if (!Number.isInteger(length) || length < 0 || length > 15)
            throw new TypeError("Invalid DEFLATE Huffman code length");
        if (length !== 0) {
            counts[length]++;
            maximumLength = Math.max(maximumLength, length);
        }
    }
    if (maximumLength === 0) return { entries: new Map(), maximumLength: 0 };

    let available = 1;
    for (let length = 1; length <= maximumLength; length++) {
        available = (available << 1) - counts[length];
        if (available < 0) throw new TypeError("Oversubscribed DEFLATE Huffman tree");
    }

    const nextCode = new Array<number>(16).fill(0);
    let code = 0;
    for (let length = 1; length <= 15; length++) {
        code = (code + counts[length - 1]) << 1;
        nextCode[length] = code;
    }

    const entries = new Map<number, number>();
    lengths.forEach((length, symbol) => {
        if (length === 0) return;
        const key = (length << 16) | reverseBits(nextCode[length]++, length);
        if (entries.has(key)) throw new TypeError("Duplicate DEFLATE Huffman code");
        entries.set(key, symbol);
    });
    return { entries, maximumLength };
}

function readDeflateCode(reader: DeflateBitReader, table: HuffmanTable): number {
    let code = 0;
    for (let length = 1; length <= table.maximumLength; length++) {
        code |= reader.readBits(1) << (length - 1);
        const symbol = table.entries.get((length << 16) | code);
        if (symbol !== undefined) return symbol;
    }
    throw new TypeError("Invalid DEFLATE Huffman code");
}

function fixedHuffmanTables(): readonly [HuffmanTable, HuffmanTable] {
    const literals = new Array<number>(288);
    for (let symbol = 0; symbol <= 143; symbol++) literals[symbol] = 8;
    for (let symbol = 144; symbol <= 255; symbol++) literals[symbol] = 9;
    for (let symbol = 256; symbol <= 279; symbol++) literals[symbol] = 7;
    for (let symbol = 280; symbol <= 287; symbol++) literals[symbol] = 8;
    return [buildHuffmanTable(literals), buildHuffmanTable(new Array<number>(32).fill(5))];
}

const FIXED_HUFFMAN_TABLES = fixedHuffmanTables();

function dynamicHuffmanTables(reader: DeflateBitReader): readonly [HuffmanTable, HuffmanTable] {
    const literalCount = reader.readBits(5) + 257;
    const distanceCount = reader.readBits(5) + 1;
    const codeLengthCount = reader.readBits(4) + 4;
    if (literalCount > 286 || distanceCount > 32) throw new TypeError("Invalid DEFLATE dynamic table size");

    const codeLengths = new Array<number>(19).fill(0);
    for (let index = 0; index < codeLengthCount; index++)
        codeLengths[CODE_LENGTH_ORDER[index]] = reader.readBits(3);
    const codeLengthTable = buildHuffmanTable(codeLengths);
    if (codeLengthTable.maximumLength === 0) throw new TypeError("Empty DEFLATE code-length table");

    const lengths: number[] = [];
    const total = literalCount + distanceCount;
    while (lengths.length < total) {
        const symbol = readDeflateCode(reader, codeLengthTable);
        if (symbol <= 15) {
            lengths.push(symbol);
            continue;
        }
        let repeat: number;
        let value: number;
        if (symbol === 16) {
            if (lengths.length === 0) throw new TypeError("DEFLATE repeat has no preceding code length");
            repeat = reader.readBits(2) + 3;
            value = lengths[lengths.length - 1];
        } else if (symbol === 17) {
            repeat = reader.readBits(3) + 3;
            value = 0;
        } else if (symbol === 18) {
            repeat = reader.readBits(7) + 11;
            value = 0;
        } else {
            throw new TypeError("Invalid DEFLATE code-length symbol");
        }
        if (lengths.length + repeat > total) throw new TypeError("DEFLATE code-length repeat exceeds table");
        for (let index = 0; index < repeat; index++) lengths.push(value);
    }

    const literals = buildHuffmanTable(lengths.slice(0, literalCount));
    const distances = buildHuffmanTable(lengths.slice(literalCount));
    if (lengths[256] === 0)
        throw new TypeError("DEFLATE literal table has no end-of-block symbol");
    return [literals, distances];
}

function decodeCompressedBlock(reader: DeflateBitReader, output: InflateOutput, literals: HuffmanTable, distances: HuffmanTable): void {
    for (;;) {
        const symbol = readDeflateCode(reader, literals);
        if (symbol < 256) {
            output.write(symbol);
            continue;
        }
        if (symbol === 256) return;
        const lengthIndex = symbol - 257;
        if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length)
            throw new TypeError("Invalid DEFLATE length symbol");
        if (distances.maximumLength === 0) throw new TypeError("DEFLATE distance table is empty");
        const length = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
        const distanceSymbol = readDeflateCode(reader, distances);
        if (distanceSymbol >= DISTANCE_BASE.length) throw new TypeError("Invalid DEFLATE distance symbol");
        const distance = DISTANCE_BASE[distanceSymbol] + reader.readBits(DISTANCE_EXTRA[distanceSymbol]);
        output.copy(distance, length);
    }
}

function adler32(input: Uint8Array): number {
    let first = 1;
    let second = 0;
    for (let offset = 0; offset < input.length;) {
        const end = Math.min(input.length, offset + 5552);
        for (; offset < end; offset++) {
            first += input[offset];
            second += first;
        }
        first %= 65521;
        second %= 65521;
    }
    return ((second << 16) | first) >>> 0;
}

/**
 * Synchronously inflates a zlib-wrapped DEFLATE stream.
 *
 * The decoder is platform-independent and rejects malformed headers, blocks,
 * back-references, trailing data, and Adler-32 mismatches.
 */
export function inflateZlibSync(input: Uint8Array): Uint8Array {
    if (input.length < 6) throw new TypeError("Truncated zlib stream");
    const compressionMethod = input[0] & 0x0f;
    const windowSize = input[0] >>> 4;
    if (compressionMethod !== 8 || windowSize > 7) throw new TypeError("Unsupported zlib compression method");
    if (((input[0] << 8) | input[1]) % 31 !== 0) throw new TypeError("Invalid zlib header checksum");
    if ((input[1] & 0x20) !== 0) throw new TypeError("Preset zlib dictionaries are unsupported");

    const checksumOffset = input.length - 4;
    const reader = new DeflateBitReader(input.subarray(2, checksumOffset));
    const output = new InflateOutput();
    let finalBlock = false;
    while (!finalBlock) {
        finalBlock = reader.readBits(1) !== 0;
        const blockType = reader.readBits(2);
        if (blockType === 0) {
            reader.alignToByte();
            const length = reader.readAlignedByte() | (reader.readAlignedByte() << 8);
            const complement = reader.readAlignedByte() | (reader.readAlignedByte() << 8);
            if (((length ^ 0xffff) & 0xffff) !== complement) throw new TypeError("Invalid DEFLATE stored-block length");
            for (let index = 0; index < length; index++) output.write(reader.readAlignedByte());
        } else if (blockType === 1) {
            decodeCompressedBlock(reader, output, FIXED_HUFFMAN_TABLES[0], FIXED_HUFFMAN_TABLES[1]);
        } else if (blockType === 2) {
            const tables = dynamicHuffmanTables(reader);
            decodeCompressedBlock(reader, output, tables[0], tables[1]);
        } else {
            throw new TypeError("Reserved DEFLATE block type");
        }
    }
    reader.finish();
    const inflated = output.finish();
    const expected = new DataView(input.buffer, input.byteOffset + checksumOffset, 4).getUint32(0, false);
    if (adler32(inflated) !== expected) throw new TypeError("Invalid zlib Adler-32 checksum");
    return inflated;
}
