import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { AntiAliasType, TextField, TextFormat, TextFormatAlign } from "../../src/layaAir/flash";
import { Input as LayaInput } from "../../src/layaAir/laya/display/Input";
import { Render2DProcessor } from "../../src/layaAir/laya/display/Render2DProcessor";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from
    "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from
    "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import {
    remapTextCoverage,
    textRasterizationCacheKey,
    textRasterizationScale,
} from "../../src/layaAir/laya/webgl/text/TextRasterizationSettings";
import { parseTrueTypeOutlineFont } from "../../src/layaAir/laya/webgl/text/TrueTypeOutline";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(Render2DProcessor as unknown as { runner: unknown }).runner = {
    _textRender: { getFontHeight: (): number => 10 },
};
Browser.context = {
    font: "10px Arial",
    fontKerning: "normal",
    measureText: (value: string) => ({ width: Array.from(value).length * 5 }),
} as unknown as CanvasRenderingContext2D;
ILaya.stage = {
    _graphicUpdateList: new Set(),
    _tranMatrixUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as unknown as typeof ILaya.stage;
ILaya.timer = { callLater: (): void => undefined } as unknown as typeof ILaya.timer;
ILaya.systemTimer = {
    callLater: (): void => undefined,
    runCallLater: (): void => undefined,
} as unknown as typeof ILaya.systemTimer;
(PAL as unknown as { textInput: unknown }).textInput = {
    target: null,
    setText: (): void => undefined,
    syncText: (): void => undefined,
};

class ProbeTextField extends TextField {
    get nativeInput(): LayaInput { return this._nativeTextInput; }
}

test("native TrueType outline parsing preserves consecutive off-curve quadratic segments", () => {
    const source = simpleTrueTypeFont();
    const font = parseTrueTypeOutlineFont(source);
    assert.ok(font);
    assert.equal(font.unitsPerEm, 1000);
    assert.deepEqual(font.glyph(1), {
        unitsPerEm: 1000,
        bounds: { xMin: 0, yMin: 0, xMax: 1000, yMax: 1000 },
        commands: [
            { op: "move", x: 1000, y: 0 },
            { op: "quadratic", cx: 0, cy: 0, x: 250, y: 500 },
            { op: "quadratic", cx: 500, cy: 1000, x: 1000, y: 0 },
            { op: "close" },
        ],
    });
    assert.equal(font.glyph(0), null);
    assert.deepEqual(font.glyphForCodePoint(0x41), font.glyph(1));
    assert.equal(font.glyphForCodePoint(0x42), null);

    const composite = source.slice(0);
    new DataView(composite).setInt16(168, -1);
    assert.equal(parseTrueTypeOutlineFont(composite)?.glyph(1), null,
        "composite placement remains on the authenticated platform fallback");
    assert.equal(parseTrueTypeOutlineFont(new ArrayBuffer(12)), null);
});

function simpleTrueTypeFont(): ArrayBuffer {
    const bytes = new Uint8Array(240);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 5);
    const tables = [
        ["head", 92, 54], ["maxp", 148, 6], ["loca", 156, 12], ["glyf", 168, 25], ["cmap", 196, 44],
    ] as const;
    tables.forEach(([tag, offset, length], index) => {
        const cursor = 12 + index * 16;
        for (let position = 0; position < 4; position++) view.setUint8(cursor + position, tag.charCodeAt(position));
        view.setUint32(cursor + 8, offset);
        view.setUint32(cursor + 12, length);
    });
    view.setUint16(110, 1000);
    view.setInt16(142, 1);
    view.setUint16(152, 2);
    view.setUint32(164, 25);
    view.setInt16(168, 1);
    view.setInt16(174, 1000);
    view.setInt16(176, 1000);
    view.setUint16(178, 2);
    bytes.set([0x30, 0x00, 0x01], 182);
    view.setInt16(185, 500);
    view.setInt16(187, 500);
    view.setInt16(189, 1000);
    view.setInt16(191, -1000);
    view.setUint16(198, 1);
    view.setUint16(200, 3);
    view.setUint16(202, 1);
    view.setUint32(204, 12);
    view.setUint16(208, 4);
    view.setUint16(210, 32);
    view.setUint16(214, 4);
    view.setUint16(216, 4);
    view.setUint16(218, 1);
    view.setUint16(222, 0x41);
    view.setUint16(224, 0xffff);
    view.setUint16(228, 0x41);
    view.setUint16(230, 0xffff);
    view.setInt16(232, -64);
    view.setInt16(234, 1);
    return bytes.buffer;
}

test("advanced CSM oversamples small embedded glyph masks before applying cutoffs", () => {
    assert.equal(textRasterizationScale(null, 1), 1);
    assert.equal(textRasterizationScale({ coverageMode: "linear-cutoff" }, 1), 2);
    assert.equal(textRasterizationScale({ coverageMode: "signed-distance-cutoff" }, 1), 2);
    assert.equal(textRasterizationScale({ coverageMode: "linear-cutoff" }, 3), 3);
    const outlineProvider = (): null => null;
    assert.equal(textRasterizationScale({ coverageMode: "platform", outlineProvider }, 1), 4,
        "authenticated vector outlines use the established four-times supersampled raster path");
    assert.equal(textRasterizationScale({ coverageMode: "platform", outlineProvider }, 6), 6);
    assert.equal(textRasterizationCacheKey({ coverageMode: "platform" }), "");
    assert.match(textRasterizationCacheKey({ coverageMode: "platform", outlineProvider }), /outline/,
        "outline-backed platform glyphs cannot alias ordinary platform text in the atlas cache");
});

test("advanced CSM derives signed outline distance before applying cutoffs", () => {
    const alphas = [0, 0, 64, 128, 192, 255, 255];
    const data = new Uint8ClampedArray(alphas.flatMap(alpha => [255, 255, 255, alpha]));
    const image = { data, width: alphas.length, height: 1 } as ImageData;
    remapTextCoverage(image, {
        coverageMode: "signed-distance-cutoff", outsideCutoff: -0.25, insideCutoff: 0.25,
    });
    assert.deepEqual(Array.from(data).filter((_, index) => index % 4 === 3), [0, 0, 0, 129, 255, 255, 255]);

    const hole = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    hole[(1 * 3 + 1) * 4 + 3] = 0;
    remapTextCoverage({ data: hole, width: 3, height: 3 } as ImageData, {
        coverageMode: "signed-distance-cutoff", outsideCutoff: -0.25, insideCutoff: 0.25,
    });
    assert.equal(hole[(1 * 3 + 1) * 4 + 3], 0, "a counter remains outside rather than being filled");
    assert.equal(hole[3], 255, "interior coverage remains opaque beyond the inside cutoff");
});

test("advanced TextField commands snapshot the authenticated outline selection", () => {
    const font = parseTrueTypeOutlineFont(simpleTrueTypeFont());
    assert.ok(font);
    const calls: unknown[][] = [];
    const field = new ProbeTextField();
    try {
        field.fontOutlineProvider = (codePoint, family, bold, italic) => {
            calls.push([codePoint, family, bold, italic]);
            return font.glyphForCodePoint(codePoint);
        };
        field.defaultTextFormat = new TextFormat("Body", 10, 0xffffff, false, false);
        field.embedFonts = true;
        field.antiAliasType = AntiAliasType.ADVANCED;
        field.text = "A";
        void field.numLines;
        const command = (field.nativeInput.graphics.cmds ?? []).find(candidate =>
            (candidate as { text?: unknown }).text === "A") as { rasterizationSettings?: {
                outlineProvider?: (codePoint: number) => unknown;
            } };
        assert.ok(command?.rasterizationSettings?.outlineProvider);
        assert.equal((command.rasterizationSettings as { coverageMode?: string }).coverageMode, "platform",
            "authenticated outlines bypass the proprietary CSM distance remap");
        assert.equal((command.rasterizationSettings as { gridFit?: string }).gridFit, "none",
            "authenticated outlines retain their source geometry instead of CSM alignment-zone snapping");
        assert.deepEqual(command.rasterizationSettings.outlineProvider(0x41), font.glyphForCodePoint(0x41));
        assert.deepEqual(calls, [[0x41, "Body", false, false]],
            "render commands retain their immutable style instead of closing over the layout cursor");
    } finally {
        field.destroy(true);
    }
});

function fieldAtHeight(height: number): ProbeTextField {
    const field = new ProbeTextField();
    field.nativeInput.fontMetricsProvider = (_font, size) => ({
        ascent: size * 0.8,
        descent: size * 0.2,
        lineGap: 0,
    });
    field.nativeInput.textAdvanceProvider = text => Array.from(text).map(() => 5);
    field.multiline = true;
    field.wordWrap = false;
    field.size(40, height);
    field.defaultTextFormat = new TextFormat(
        "Arial", 10, 0xffffff, false, false, false,
        null, null, TextFormatAlign.LEFT, 0, 0, 0, 2,
    );
    field.text = "abc\rdef\rghi";
    void field.numLines;
    return field;
}

function renderedLines(field: ProbeTextField): string[] {
    return (field.nativeInput.graphics.cmds ?? [])
        .map(command => (command as { text?: unknown }).text)
        .filter((value): value is string => typeof value === "string");
}

test("Flash gutter admits a complete first line without admitting later overflow", () => {
    const compact = fieldAtHeight(17);
    const lineY = compact.nativeInput.lines.map(line => line.y);
    assert.deepEqual(renderedLines(compact), ["abc"]);
    compact.text = compact.text;
    void compact.numLines;
    assert.deepEqual(compact.nativeInput.lines.map(line => line.y), lineY,
        "temporary render clipping never mutates retained Flash layout");
    assert.deepEqual([compact.height, compact.nativeInput.height], [17, 17]);
    assert.deepEqual(renderedLines(compact), ["abc"]);
    compact.scrollV = 2;
    assert.deepEqual(renderedLines(compact), ["def"],
        "scrollV renders the requested line without admitting its successor");
    assert.deepEqual(compact.nativeInput.lines.map(line => line.y), lineY,
        "scrolled rendering restores every retained line position");
    assert.deepEqual([compact.height, compact.nativeInput.height], [17, 17]);
    compact.scrollV = 3;
    assert.deepEqual(renderedLines(compact), ["ghi"]);
    assert.deepEqual(compact.nativeInput.lines.map(line => line.y), lineY);
    compact.scrollV = 1;
    assert.deepEqual(renderedLines(compact), ["abc"]);
    assert.deepEqual(renderedLines(fieldAtHeight(25)), ["abc"]);
});

test("a line that does not fit the full Flash field remains hidden", () => {
    assert.deepEqual(renderedLines(fieldAtHeight(12)), []);
});
