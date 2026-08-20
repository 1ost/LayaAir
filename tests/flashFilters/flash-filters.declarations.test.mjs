import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated declarations expose GradientBevelFilter without internal bevel machinery", async () => {
    const coreDeclaration = await readFile(new URL("../../build/types/LayaAir.d.ts", import.meta.url), "utf8");
    const flashDeclaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    const internalNames = [
        "FlashBevelPlacement", "FlashGradientBevelEffectOptions", "FlashAuthoredBevelFilterOptions",
        "FlashBevelGradient", "NormalizedFlashBevelEffectOptions", "FlashBevelEffect2D",
        "createFlashAuthoredBevelFilter",
    ];
    for (const name of internalNames) {
        assert.doesNotMatch(coreDeclaration, new RegExp(`\\b${name}\\b`), `${name} must stay out of LayaAir.d.ts`);
        assert.doesNotMatch(flashDeclaration, new RegExp(`\\b${name}\\b`), `${name} must stay out of LayaFlash.d.ts`);
    }
    assert.match(flashDeclaration, /class GradientBevelFilter extends BitmapFilter/);
});

test("generated bundles keep bevel effect and authored factory private to the Flash bundle", async () => {
    const coreBundle = await readFile(new URL("../../build/libs/laya.core.js", import.meta.url), "utf8");
    const flashBundle = await readFile(new URL("../../build/libs/laya.flash.js", import.meta.url), "utf8");
    assert.doesNotMatch(coreBundle, /\b(?:FlashBevelEffect2D|createFlashAuthoredBevelFilter)\b/);
    assert.match(flashBundle, /class FlashBevelEffect2D extends/);
    assert.doesNotMatch(flashBundle, /exports\.(?:FlashBevelEffect2D|createFlashAuthoredBevelFilter)\s*=/);
});
