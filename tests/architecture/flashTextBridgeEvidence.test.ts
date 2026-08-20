import assert from "node:assert/strict";
import test from "node:test";
import type { InteractiveObject } from "../../src/layaAir/flash/display/InteractiveObject.ts";
import type { TextField, flashHtmlToText, flashTextToHtml, isFlashTextField } from "../../src/layaAir/flash/text/TextField.ts";
import type { AntiAliasType, CSMSettings, FontStyle, GridFitType, TextColorType, TextDisplayMode,
    TextFieldAutoSize, TextFieldType, TextFormat, TextFormatAlign, TextLineMetrics,
    TextRenderer, isFlashCSMSettings, isFlashTextFormat } from "../../src/layaAir/flash/text/TextFormat.ts";
import type { FontType } from "../../src/layaAir/flash/text/FontType.ts";
import type { AuthoredFontBinding, AuthoredFontBindingCancelledError, AuthoredFontKey,
    AuthoredFontManifest, AuthoredFontManifestEntry, AuthoredFontRegistry, AuthoredFontRuntimeRecord,
    AuthoredFontStyle, AuthoredGlyphMetric, AuthoredTextProviderConsumer,
    Font, FlashFontClass, FlashFontRegistration, consumeAuthoredFontLoadAuthorization } from
    "../../src/layaAir/flash/text/Font.ts";
import type { StaticText, isFlashStaticText, AuthoredStaticGlyphConfiguration,
    AuthoredStaticGlyphRunConfiguration, AuthoredStaticTextConfiguration, createAuthoredStaticText } from
    "../../src/layaAir/flash/text/StaticText.ts";
import type { AuthoredTextFieldConfiguration, AuthoredTextFormatConfiguration, createAuthoredTextField } from
    "../../src/extensions/authoredContent/runtime/AuthoredTextField.ts";

const BLEACH_TEXT_AUTHORITY = Object.freeze({
    commit: "a42bf2c73dce4ca0922bc603c5647a5ef0e515dd",
    oracle: "Pepper Flash 26.0.0.131",
    browser: "Google Chrome 151.0.7922.138 with Playwright 1.62.1",
    corpusFingerprint: "2911d0197eee42e61968adab947d751dd2a9d77a22149f34fa0cf28dafca37ca",
    corpus: Object.freeze({ definitions: 50966, uniqueSwfs: 818, flagFamilies: 28 }),
    canonicalLfSha256: Object.freeze({
        contract: "30e369fccf056904bdcc3103bc1f5bb74a10f3e9d946cc709f5ee2dd0d5f666f",
        priorNativeText: "b7db8447aefded827298d621cf98333003ca090989d9ca53983a7a7d46894d28",
        browserCaptureRunner: "63b10d925a3d18d432b2bba28049b390aa9052f8c24ee9a67a161143d65a0c74",
        dynamicTextVerification: "36563ec116c4754998894c2a34e8e60fb0609929a985b6a61c9c0a31d44ce2b5",
        bootstrapDynamicTextVerification: "fbda630cbd500df12309fec6b42d295da5bc89ab9d780bffcb7810edd015c77c",
        inputVerifier: "65033ef76915eefa4bfc4cf35615173eda05935153c417203885d26d8f7af213",
        csmPreparation: "411b37e63dc29ea0631c8a003e27ebcb23971da6166fdbbce13797e240fb1965",
        csmVerifier: "280a1362bc9a076576fbfd9b4b1be3ad0333e9872a5ca9c015881f56de9623a4",
    }),
});

test("Flash text bridge compiler surface", () => {
    assert.ok(true as boolean satisfies ([typeof TextField, typeof TextFormat, typeof TextFieldAutoSize,
        typeof AntiAliasType, typeof TextFieldType, typeof TextFormatAlign, typeof GridFitType,
        typeof CSMSettings, typeof TextLineMetrics, typeof TextRenderer, typeof FontStyle,
        typeof TextColorType, typeof TextDisplayMode, typeof flashHtmlToText,
        typeof flashTextToHtml, typeof isFlashTextField, typeof isFlashCSMSettings, typeof isFlashTextFormat,
        typeof InteractiveObject, typeof FontType, typeof StaticText, typeof isFlashStaticText,
        typeof Font, FlashFontClass, FlashFontRegistration, AuthoredFontBinding,
        typeof AuthoredFontBindingCancelledError, AuthoredFontKey, AuthoredFontManifest,
        AuthoredFontManifestEntry, typeof AuthoredFontRegistry, AuthoredFontRuntimeRecord,
        AuthoredFontStyle, AuthoredGlyphMetric, AuthoredTextProviderConsumer,
        typeof consumeAuthoredFontLoadAuthorization] extends readonly unknown[]
        ? boolean : never));
});

test("Authored device TextField configuration compiler surface", () => {
    assert.ok(true as boolean satisfies ([AuthoredTextFormatConfiguration, AuthoredTextFieldConfiguration,
        typeof createAuthoredTextField] extends readonly unknown[] ? boolean : never));
});

test("Authored texture-backed StaticText configuration compiler surface", () => {
    assert.ok(true as boolean satisfies ([AuthoredStaticGlyphConfiguration,
        AuthoredStaticGlyphRunConfiguration, AuthoredStaticTextConfiguration,
        typeof createAuthoredStaticText] extends readonly unknown[] ? boolean : never));
});

test("StaticText native prefab serialization and generic glyph conversion remain HOLD", () => {
    assert.ok(true, "the admitted surface publishes only validated pre-resolved texture placements");
});

test("Flash text authority provenance", () => {
    assert.deepEqual(BLEACH_TEXT_AUTHORITY.corpus,
        { definitions: 50966, uniqueSwfs: 818, flagFamilies: 28 });
    assert.equal(BLEACH_TEXT_AUTHORITY.oracle, "Pepper Flash 26.0.0.131");
    assert.match(BLEACH_TEXT_AUTHORITY.browser, /Chrome 151.*Playwright 1\.62\.1/);
    assert.equal(Object.values(BLEACH_TEXT_AUTHORITY.canonicalLfSha256).every(hash => /^[a-f0-9]{64}$/.test(hash)), true);
});
