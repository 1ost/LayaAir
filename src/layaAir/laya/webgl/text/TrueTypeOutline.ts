export type TrueTypeOutlineCommand =
    | Readonly<{ op: "move"; x: number; y: number }>
    | Readonly<{ op: "line"; x: number; y: number }>
    | Readonly<{ op: "quadratic"; cx: number; cy: number; x: number; y: number }>
    | Readonly<{ op: "close" }>;

export interface TrueTypeGlyphOutline {
    readonly unitsPerEm: number;
    readonly bounds: Readonly<{ xMin: number; yMin: number; xMax: number; yMax: number }>;
    readonly commands: readonly TrueTypeOutlineCommand[];
}

export interface TrueTypeOutlineFont {
    readonly unitsPerEm: number;
    glyph(index: number): TrueTypeGlyphOutline | null;
    glyphForCodePoint(codePoint: number): TrueTypeGlyphOutline | null;
}

type Point = { x: number; y: number; onCurve: boolean };
type Table = { offset: number; length: number };

/** Parse only native TrueType `glyf` outlines. CFF and malformed data fail closed. */
export function parseTrueTypeOutlineFont(value: ArrayBuffer): TrueTypeOutlineFont | null {
    try {
        const bytes = new Uint8Array(value.slice(0));
        const view = new DataView(bytes.buffer);
        if (view.byteLength < 12 || view.getUint32(0) !== 0x00010000) return null;
        const tables = tableDirectory(view);
        const head = requireTable(tables, "head", view.byteLength, 54);
        const maxp = requireTable(tables, "maxp", view.byteLength, 6);
        const loca = requireTable(tables, "loca", view.byteLength, 2);
        const glyf = requireTable(tables, "glyf", view.byteLength, 0);
        const cmap = requireTable(tables, "cmap", view.byteLength, 4);
        const unitsPerEm = view.getUint16(head.offset + 18);
        const glyphCount = view.getUint16(maxp.offset + 4);
        const locationFormat = view.getInt16(head.offset + 50);
        if (!unitsPerEm || !glyphCount || (locationFormat !== 0 && locationFormat !== 1)) return null;
        const locationBytes = (glyphCount + 1) * (locationFormat === 0 ? 2 : 4);
        if (locationBytes > loca.length) return null;
        const offsets = new Uint32Array(glyphCount + 1);
        for (let index = 0; index <= glyphCount; index++) {
            offsets[index] = locationFormat === 0
                ? view.getUint16(loca.offset + index * 2) * 2
                : view.getUint32(loca.offset + index * 4);
            if (offsets[index] > glyf.length || index > 0 && offsets[index] < offsets[index - 1]) return null;
        }
        const cache = new Map<number, TrueTypeGlyphOutline | null>();
        const glyphIndexForCodePoint = parseCmap(view, cmap);
        const glyph = (index: number): TrueTypeGlyphOutline | null => {
            if (!Number.isInteger(index) || index < 0 || index >= glyphCount) return null;
            if (cache.has(index)) return cache.get(index)!;
            const start = glyf.offset + offsets[index];
            const end = glyf.offset + offsets[index + 1];
            const outline = start === end ? null : parseSimpleGlyph(view, start, end, unitsPerEm);
            cache.set(index, outline);
            return outline;
        };
        const font: TrueTypeOutlineFont = Object.freeze({
            unitsPerEm,
            glyph,
            glyphForCodePoint(codePoint: number): TrueTypeGlyphOutline | null {
                const index = glyphIndexForCodePoint(codePoint);
                return index == null ? null : glyph(index);
            },
        });
        return font;
    } catch {
        return null;
    }
}

function parseCmap(view: DataView, table: Table): (codePoint: number) => number | null {
    if (view.getUint16(table.offset) !== 0) throw new Error("unsupported TrueType cmap version");
    const count = view.getUint16(table.offset + 2);
    if (4 + count * 8 > table.length) throw new Error("truncated TrueType cmap directory");
    const candidates: Array<{ priority: number; offset: number; format: number }> = [];
    for (let index = 0; index < count; index++) {
        const cursor = table.offset + 4 + index * 8;
        const platform = view.getUint16(cursor);
        const encoding = view.getUint16(cursor + 2);
        const relative = view.getUint32(cursor + 4);
        if (relative + 2 > table.length) continue;
        const format = view.getUint16(table.offset + relative);
        const priority = format === 12 && platform === 3 && encoding === 10 ? 4
            : format === 12 && platform === 0 ? 3
                : format === 4 && platform === 3 && encoding === 1 ? 2
                    : format === 4 && platform === 0 ? 1 : 0;
        if (priority) candidates.push({ priority, offset: table.offset + relative, format });
    }
    const selected = candidates.sort((left, right) => right.priority - left.priority)[0];
    if (!selected) throw new Error("TrueType cmap lacks Unicode mapping");
    return selected.format === 12
        ? parseCmapFormat12(view, selected.offset, table.offset + table.length)
        : parseCmapFormat4(view, selected.offset, table.offset + table.length);
}

function parseCmapFormat4(view: DataView, offset: number, tableEnd: number): (codePoint: number) => number | null {
    if (offset + 16 > tableEnd) throw new Error("truncated TrueType cmap format 4");
    const length = view.getUint16(offset + 2);
    const end = offset + length;
    const segmentCount = view.getUint16(offset + 6) / 2;
    if (!Number.isInteger(segmentCount) || segmentCount <= 0 || end > tableEnd || 16 + segmentCount * 8 > length)
        throw new Error("invalid TrueType cmap format 4");
    const ends = offset + 14;
    const starts = ends + segmentCount * 2 + 2;
    const deltas = starts + segmentCount * 2;
    const ranges = deltas + segmentCount * 2;
    return (codePoint: number): number | null => {
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0xffff) return null;
        for (let index = 0; index < segmentCount; index++) {
            const endCode = view.getUint16(ends + index * 2);
            if (codePoint > endCode) continue;
            const startCode = view.getUint16(starts + index * 2);
            if (codePoint < startCode) return null;
            const delta = view.getInt16(deltas + index * 2);
            const range = view.getUint16(ranges + index * 2);
            if (range === 0) {
                const glyph = (codePoint + delta) & 0xffff;
                return glyph || null;
            }
            const glyphAddress = ranges + index * 2 + range + (codePoint - startCode) * 2;
            if (glyphAddress + 2 > end) return null;
            const glyph = view.getUint16(glyphAddress);
            return glyph ? (glyph + delta) & 0xffff : null;
        }
        return null;
    };
}

function parseCmapFormat12(view: DataView, offset: number, tableEnd: number): (codePoint: number) => number | null {
    if (offset + 16 > tableEnd) throw new Error("truncated TrueType cmap format 12");
    const length = view.getUint32(offset + 4);
    const count = view.getUint32(offset + 12);
    const end = offset + length;
    if (end > tableEnd || 16 + count * 12 > length) throw new Error("invalid TrueType cmap format 12");
    return (codePoint: number): number | null => {
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return null;
        let low = 0;
        let high = count - 1;
        while (low <= high) {
            const index = (low + high) >>> 1;
            const cursor = offset + 16 + index * 12;
            const start = view.getUint32(cursor);
            const finish = view.getUint32(cursor + 4);
            if (codePoint < start) high = index - 1;
            else if (codePoint > finish) low = index + 1;
            else {
                const glyph = view.getUint32(cursor + 8) + codePoint - start;
                return glyph || null;
            }
        }
        return null;
    };
}

function tableDirectory(view: DataView): Map<string, Table> {
    const count = view.getUint16(4);
    if (12 + count * 16 > view.byteLength) throw new Error("truncated TrueType table directory");
    const result = new Map<string, Table>();
    for (let index = 0; index < count; index++) {
        const cursor = 12 + index * 16;
        const tag = String.fromCharCode(
            view.getUint8(cursor), view.getUint8(cursor + 1), view.getUint8(cursor + 2), view.getUint8(cursor + 3),
        );
        if (result.has(tag)) throw new Error(`duplicate TrueType table ${tag}`);
        const offset = view.getUint32(cursor + 8);
        const length = view.getUint32(cursor + 12);
        if (offset > view.byteLength || length > view.byteLength - offset) throw new Error(`truncated TrueType table ${tag}`);
        result.set(tag, { offset, length });
    }
    return result;
}

function requireTable(tables: Map<string, Table>, tag: string, total: number, minimum: number): Table {
    const table = tables.get(tag);
    if (!table || table.length < minimum || table.offset > total - table.length)
        throw new Error(`missing TrueType table ${tag}`);
    return table;
}

function parseSimpleGlyph(view: DataView, start: number, end: number, unitsPerEm: number): TrueTypeGlyphOutline | null {
    if (end - start < 10) return null;
    const contourCount = view.getInt16(start);
    // Composite glyph placement needs point-to-point component attachment and
    // is deliberately left on the platform renderer until that full contract is implemented.
    if (contourCount <= 0) return null;
    const bounds = Object.freeze({
        xMin: view.getInt16(start + 2), yMin: view.getInt16(start + 4),
        xMax: view.getInt16(start + 6), yMax: view.getInt16(start + 8),
    });
    if (bounds.xMax < bounds.xMin || bounds.yMax < bounds.yMin) return null;
    let cursor = start + 10;
    if (cursor + contourCount * 2 + 2 > end) return null;
    const ends: number[] = [];
    for (let index = 0; index < contourCount; index++) {
        const value = view.getUint16(cursor);
        cursor += 2;
        if (index > 0 && value <= ends[index - 1]) return null;
        ends.push(value);
    }
    const pointCount = ends[ends.length - 1] + 1;
    const instructionLength = view.getUint16(cursor);
    cursor += 2;
    if (cursor + instructionLength > end) return null;
    cursor += instructionLength;

    const flags: number[] = [];
    while (flags.length < pointCount) {
        if (cursor >= end) return null;
        const flag = view.getUint8(cursor++);
        flags.push(flag);
        if (flag & 0x08) {
            if (cursor >= end) return null;
            const repeats = view.getUint8(cursor++);
            if (flags.length + repeats > pointCount) return null;
            for (let repeat = 0; repeat < repeats; repeat++) flags.push(flag);
        }
    }

    const xs: number[] = [];
    let x = 0;
    for (const flag of flags) {
        if (flag & 0x02) {
            if (cursor >= end) return null;
            const delta = view.getUint8(cursor++);
            x += flag & 0x10 ? delta : -delta;
        } else if (!(flag & 0x10)) {
            if (cursor + 2 > end) return null;
            x += view.getInt16(cursor);
            cursor += 2;
        }
        xs.push(x);
    }
    const points: Point[] = [];
    let y = 0;
    for (let index = 0; index < flags.length; index++) {
        const flag = flags[index];
        if (flag & 0x04) {
            if (cursor >= end) return null;
            const delta = view.getUint8(cursor++);
            y += flag & 0x20 ? delta : -delta;
        } else if (!(flag & 0x20)) {
            if (cursor + 2 > end) return null;
            y += view.getInt16(cursor);
            cursor += 2;
        }
        points.push({ x: xs[index], y, onCurve: Boolean(flag & 0x01) });
    }

    const commands: TrueTypeOutlineCommand[] = [];
    let first = 0;
    for (const last of ends) {
        appendContour(commands, points.slice(first, last + 1));
        first = last + 1;
    }
    return commands.length ? Object.freeze({ unitsPerEm, bounds, commands: Object.freeze(commands) }) : null;
}

function appendContour(commands: TrueTypeOutlineCommand[], points: readonly Point[]): void {
    if (!points.length) return;
    const first = points[0];
    const last = points[points.length - 1];
    const start = first.onCurve ? first : last.onCurve ? last : midpoint(last, first);
    commands.push(Object.freeze({ op: "move", x: start.x, y: start.y }));
    const remaining = first.onCurve ? points.slice(1) : last.onCurve ? points.slice(0, -1) : points.slice();
    let index = 0;
    while (index < remaining.length) {
        const point = remaining[index];
        if (point.onCurve) {
            commands.push(Object.freeze({ op: "line", x: point.x, y: point.y }));
            index++;
            continue;
        }
        const next = remaining[index + 1] ?? start;
        const end = next.onCurve ? next : midpoint(point, next);
        commands.push(Object.freeze({ op: "quadratic", cx: point.x, cy: point.y, x: end.x, y: end.y }));
        index += next.onCurve && index + 1 < remaining.length ? 2 : 1;
    }
    commands.push(Object.freeze({ op: "close" }));
}

function midpoint(left: Point, right: Point): Point {
    return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, onCurve: true };
}
