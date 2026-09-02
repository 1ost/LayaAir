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
import {
    applyAuthoredLocaleText, createAuthoredTextField, type AuthoredTextFieldConfiguration,
} from "../../src/extensions/authoredContent/runtime/AuthoredTextField";

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
const FALLBACK_FONT_MARKUP = '<p align="left"><font face="Arial" size="12" color="#ffc867" letterSpacing="0.000000" kerning="0">Today&apos;s remaining reward chances<font face="MS PGothic">ï¼š</font></font></p>';
const MULTI_PARAGRAPH_MARKUP = '<p align="center"><font face="Arial" size="10" color="#ffffff" letterSpacing="0.000000" kerning="0">Do not start fighting </font></p><p align="center"><font face="Arial" size="10" color="#ffffff" letterSpacing="0.000000" kerning="0">Then kicked captain</font></p>';
const EMPTY_TRAILING_PARAGRAPH_MARKUP = '<p align="right"><font face="Arial" size="10" color="#dea05d" letterSpacing="0.000000" kerning="0">Consumes Basic <sbr />Gikogan</font></p><p align="right"></p>';
const EMPTY_ONLY_PARAGRAPHS_MARKUP = '<p align="center"></p><p align="center"></p>';
const LETTER_SPACING_RUN_MARKUP = '<p align="left"><font face="Arial" size="14" color="#ffffff" letterSpacing="2.000000" kerning="0"><b>Hueco Mundo <sbr />Shinigam</b><font letterSpacing="0.000000"><b>i</b></font></font></p>';
const BOLD_FONT_WITH_FALLBACK_MARKUP = '<p align="left"><font face="Arial" size="14" color="#ff8448" letterSpacing="1.000000" kerning="0"><b>Introduction</b><font face="SimSun">\uff1a</font></font></p>';

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

test("restricted Flash HTML preserves stable nested fallback-font runs", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(FALLBACK_FONT_MARKUP), {
        markup: FALLBACK_FONT_MARKUP, plainText: "Today's remaining reward chancesï¼š",
        align: "left", font: "Arial", size: 12, color: 0xffc867,
        letterSpacing: 0, kerning: false, bold: false,
    });
    const fallbackConfiguration = configuration(FALLBACK_FONT_MARKUP);
    const field = createAuthoredTextField({
        ...fallbackConfiguration,
        format: {
            ...fallbackConfiguration.format,
            font: "Arial", size: 12, color: 0xffc867, bold: false, align: "left", kerning: false,
        },
    });
    try {
        assert.equal(field.htmlText, FALLBACK_FONT_MARKUP);
        assert.equal(field.text, "Today's remaining reward chancesï¼š");
    } finally { field.destroy(true); }
});

test("restricted Flash HTML preserves adjacent same-format paragraph runs", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(MULTI_PARAGRAPH_MARKUP), {
        markup: MULTI_PARAGRAPH_MARKUP, plainText: "Do not start fighting \rThen kicked captain",
        align: "center", font: "Arial", size: 10, color: 0xffffff,
        letterSpacing: 0, kerning: false, bold: false,
    });
    const multiParagraphConfiguration = configuration(MULTI_PARAGRAPH_MARKUP);
    const field = createAuthoredTextField({
        ...multiParagraphConfiguration,
        multiline: true,
        format: {
            ...multiParagraphConfiguration.format,
            font: "Arial", color: 0xffffff, bold: false, kerning: false,
        },
    });
    try {
        assert.equal(field.htmlText, MULTI_PARAGRAPH_MARKUP);
        assert.equal(field.text.replace(/\n/g, "\r"), "Do not start fighting \rThen kicked captain");
    } finally { field.destroy(true); }
});

test("restricted Flash HTML preserves authenticated empty trailing paragraphs", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(EMPTY_TRAILING_PARAGRAPH_MARKUP), {
        markup: EMPTY_TRAILING_PARAGRAPH_MARKUP, plainText: "Consumes Basic Gikogan\r",
        align: "right", font: "Arial", size: 10, color: 0xdea05d,
        letterSpacing: 0, kerning: false, bold: false,
    });
});

test("restricted Flash HTML preserves authenticated nested face and mixed bold runs", () => {
    const markup = '<p align="left"><font face="MS PGothic" size="12" color="#00dedb" letterSpacing="0.000000" kerning="0">『<font face="Arial"><b>Event Explanation</b></font>』</font></p>';
    assert.deepEqual(parseRestrictedFlashHtmlText(markup), {
        markup, plainText: "『Event Explanation』", align: "left", font: "MS PGothic", size: 12,
        color: 0x00dedb, letterSpacing: 0, kerning: false, bold: false,
    });
    assert.equal(createAuthoredTextField({
        ...configuration(markup),
        format: { ...configuration(markup).format, font: "MS PGothic", size: 12, color: 0x00dedb, bold: false, align: "left", kerning: false },
    }).htmlText, markup);
});

test("authored HTML uses field authority for empty-only initial and localized paragraphs", () => {
    const field = createAuthoredTextField(configuration(EMPTY_ONLY_PARAGRAPHS_MARKUP));
    try {
        assert.equal(field.htmlText, EMPTY_ONLY_PARAGRAPHS_MARKUP);
        assert.equal(field.text, "");
        const localized = '<p align="center"></p>';
        applyAuthoredLocaleText(field, localized);
        assert.equal(field.htmlText, localized);
        assert.equal(field.text, "");
    } finally { field.destroy(true); }
});

test("restricted Flash HTML preserves authored input fields", () => {
    const field = createAuthoredTextField({ ...configuration(), type: "input" });
    try {
        const native = field.children[0] as LayaInput;
        assert.equal(field.type, "input");
        assert.equal(field.htmlText, MARKUP);
        assert.equal(field.text, "\u2026\u2026");
        assert.equal(native.html, true);
    } finally { field.destroy(true); }
});

test("restricted Flash HTML preserves authenticated nested letter-spacing runs", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(LETTER_SPACING_RUN_MARKUP), {
        markup: LETTER_SPACING_RUN_MARKUP, plainText: "Hueco Mundo Shinigami", align: "left", font: "Arial", size: 14,
        color: 0xffffff, letterSpacing: 2, kerning: false, bold: true,
    });
    const base = configuration(LETTER_SPACING_RUN_MARKUP);
    const field = createAuthoredTextField({
        ...base,
        multiline: true,
        format: {
            ...base.format,
            font: "Arial", size: 14, color: 0xffffff, letterSpacing: 2,
            kerning: false, bold: true, align: "left",
        },
    });
    try {
        assert.equal(field.htmlText, LETTER_SPACING_RUN_MARKUP);
        assert.equal(field.text.replace(/\n/g, "\r"), "Hueco Mundo Shinigami");
    } finally { field.destroy(true); }
});

test("restricted Flash HTML retains inline emphasis independently from the authored font style", () => {
    assert.deepEqual(parseRestrictedFlashHtmlText(BOLD_FONT_WITH_FALLBACK_MARKUP), {
        markup: BOLD_FONT_WITH_FALLBACK_MARKUP, plainText: "Introduction\uff1a", align: "left", font: "Arial", size: 14,
        color: 0xff8448, letterSpacing: 1, kerning: false, bold: false,
    });
    const base = configuration(BOLD_FONT_WITH_FALLBACK_MARKUP);
    const field = createAuthoredTextField({
        ...base,
        format: {
            ...base.format,
            font: "Arial", size: 14, color: 0xff8448, letterSpacing: 1,
            kerning: false, bold: true, align: "left",
        },
    });
    try {
        assert.equal(field.htmlText, BOLD_FONT_WITH_FALLBACK_MARKUP);
        assert.equal(field.text, "Introduction\uff1a");
    } finally { field.destroy(true); }
});

test("restricted Flash HTML fails closed before TextField publication", () => {
    for (const markup of [
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><i>bad</i></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><b>bad</font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font color="#fff">bad</font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="Other" color="#ffffff">bad</font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><b><font face="Other">bad</b></font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1">&bogus;</font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="Bad\u0001Face">bad</font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="TestSans" color="#ffffff">bad</font></font></p>',
        LETTER_SPACING_RUN_MARKUP.replace('letterSpacing="0.000000"', 'letterSpacing="NaN"'),
        LETTER_SPACING_RUN_MARKUP.replace('letterSpacing="0.000000"', 'letterSpacing="0" color="#ffffff"'),
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="TestSans"><b>bad</font></b></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1"><font face="TestSans">bad</font></font></font></p>',
        '<p align="center"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1">one</font></p><p align="left"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1">two</font></p>',
        EMPTY_TRAILING_PARAGRAPH_MARKUP.replace('<p align="right"></p>', '<p align="left"></p>'),
        EMPTY_TRAILING_PARAGRAPH_MARKUP.replace('<p align="right"></p>', '<p align="right" onclick="x"></p>'),
        '<p align="center" onclick="x"><font face="TestSans" size="10" color="#fff7c5" letterSpacing="0.000000" kerning="1">bad</font></p>',
    ]) assert.throws(() => parseRestrictedFlashHtmlText(markup), /AUTHORED_CONTENT_HTML_TEXT/);
    assert.throws(() => createAuthoredTextField({ ...configuration(), format: { ...configuration().format, color: 0xffffff } }), /must match its exact format/);
});
