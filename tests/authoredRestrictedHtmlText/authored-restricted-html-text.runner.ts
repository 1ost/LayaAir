import assert from "node:assert/strict";
import test from "node:test";
import { ILaya } from "../../src/layaAir/ILaya";
import { Input as LayaInput } from "../../src/layaAir/laya/display/Input";
import { Render2DProcessor } from "../../src/layaAir/laya/display/Render2DProcessor";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { parseRestrictedFlashHtmlText } from "../../src/extensions/authoredContent/core/RestrictedFlashHtmlText";
import { createAuthoredTextField, type AuthoredTextFieldConfiguration } from "../../src/extensions/authoredContent/runtime/AuthoredTextField";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(Render2DProcessor as unknown as { runner: unknown }).runner = { _textRender: { getFontHeight: (): number => 10 } };
Browser.context = {
    font: "10px TestSans", fontKerning: "normal",
    measureText: (value: string) => ({ width: Array.from(value).length * 5 }),
} as unknown as CanvasRenderingContext2D;
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set(), _componentDriver: { _toDestroys: new Set() } } as any;
ILaya.timer = { callLater: (): void => undefined } as any;
ILaya.systemTimer = { callLater: (): void => undefined, runCallLater: (): void => undefined } as any;
(PAL as any).textInput = {
    target: null, begin(target: unknown): void { this.target = target; }, end(): void { this.target = null; },
    setText: (): void => undefined, setSelection: (): void => undefined,
    syncSelection: (): void => undefined, syncText: (): void => undefined,
};
(PAL as any).browser ??= { on: (): void => undefined };

const MARKUP = '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><b>……</b></font></p>';
const REDUNDANT_FONT_MARKUP = '<p align="right"><font face="Arial" size="12" color="#ffffff" letterSpacing="0.000000" kerning="0">Current Level<font face="Arial">ï¼š</font></font></p>';

function configuration(markup = MARKUP): AuthoredTextFieldConfiguration {
    return {
        sourceId: 25, x: 0, y: 0, width: 160, height: 20, type: "dynamic",
        multiline: false, wordWrap: false, selectable: true, displayAsPassword: false,
        autoSize: "none", html: true, useOutlines: false, gutter: 2, overflow: "hidden", initialText: markup,
        format: {
            fontMode: "device", font: "TestSans", size: 10, color: 0xfff7c5,
            bold: true, italic: false, underline: false, align: "center",
            leftMargin: 0, rightMargin: 0, indent: 0, leading: 0, letterSpacing: 0, kerning: true,
        },
    };
}

test("restricted Flash HTML preserves nested bold markup and later mutation semantics", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(MARKUP), {
        markup: MARKUP, plainText: "……", align: "center", font: "TestSans", size: 10,
        color: 0xfff7c5, letterSpacing: 0, kerning: true, bold: true,
    });
    const field = createAuthoredTextField(configuration());
    try {
        const native = field.children[0] as LayaInput;
        assert.equal(field.htmlText, MARKUP);
        assert.equal(field.text, "……");
        assert.equal(field.selectable, true);
        assert.equal(native.html, true);
        field.text = "plain & later";
        assert.equal(field.htmlText, "plain &amp; later");
        assert.equal(native.html, false);
        const replacement = MARKUP.replace("……", "A&amp;B");
        field.htmlText = replacement;
        assert.equal(field.htmlText, replacement);
        assert.equal(field.text, "A&B");
        assert.equal(native.html, true);
    } finally { field.destroy(true); }
});

test("restricted Flash HTML preserves redundant same-face font runs", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(REDUNDANT_FONT_MARKUP), {
        markup: REDUNDANT_FONT_MARKUP, plainText: "Current Levelï¼š", align: "right", font: "Arial", size: 12,
        color: 0xffffff, letterSpacing: 0, kerning: false, bold: false,
    });
});

test("restricted Flash HTML fails closed before TextField publication", () => {
    for (const markup of [
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><i>bad</i></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><b>bad</font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1">&bogus;</font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="Other">bad</font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="TestSans" color="#ffffff">bad</font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="TestSans"><b>bad</font></b></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="TestSans">bad</font></font></font></p>',
        '<p align="center" onclick="x"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1">bad</font></p>',
    ]) assert.throws(() => parseRestrictedFlashHtmlText(markup), /AUTHORED_CONTENT_HTML_TEXT/);
    assert.throws(() => createAuthoredTextField({ ...configuration(), format: { ...configuration().format, color: 0xffffff } }), /must match its exact format/);
    assert.throws(() => createAuthoredTextField({ ...configuration(), type: "input" }), /admitted only for dynamic fields/);
});
