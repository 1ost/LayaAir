import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { TextField, TextFormat, TextFormatAlign } from "../../src/layaAir/flash";
import { Input as LayaInput } from "../../src/layaAir/laya/display/Input";
import { Render2DProcessor } from "../../src/layaAir/laya/display/Render2DProcessor";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from
    "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from
    "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { remapTextCoverage, textRasterizationScale } from "../../src/layaAir/laya/webgl/text/TextRasterizationSettings";

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

test("advanced CSM oversamples small embedded glyph masks before applying cutoffs", () => {
    assert.equal(textRasterizationScale(null, 1), 1);
    assert.equal(textRasterizationScale({ coverageMode: "linear-cutoff" }, 1), 2);
    assert.equal(textRasterizationScale({ coverageMode: "signed-distance-cutoff" }, 1), 2);
    assert.equal(textRasterizationScale({ coverageMode: "linear-cutoff" }, 3), 3);
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
