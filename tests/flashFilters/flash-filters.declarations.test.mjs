import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated declarations explicitly expose the complete LayaAir bevel bridge surface", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaAir.d.ts", import.meta.url), "utf8");
    const publicNames = [
        "FlashBevelPlacement",
        "FlashGradientBevelEffectOptions",
        "FlashAuthoredBevelFilterOptions",
        "FlashBevelGradient",
        "NormalizedFlashBevelEffectOptions",
        "FlashBevelEffect2D",
        "createFlashAuthoredBevelFilter",
    ];
    const exportStatement = declaration.match(/export \{[\s\S]*\};\s*$/)?.[0];
    assert.ok(exportStatement, "LayaAir declaration bundle must end in an explicit export list");
    for (const name of publicNames)
        assert.match(exportStatement, new RegExp(`\\b${name}\\b`), `${name} must be explicitly public`);
    assert.match(declaration, /interface FlashBevelGradient\s*\{/);
    assert.match(declaration, /interface NormalizedFlashBevelEffectOptions\s+extends/);
    assert.match(declaration, /readonly options: Readonly<NormalizedFlashBevelEffectOptions>/);
});

test("generated core runtime deliberately exports the two value-level bevel bridges", async () => {
    const bundle = await readFile(new URL("../../build/libs/laya.core.js", import.meta.url), "utf8");
    assert.match(bundle, /exports\.FlashBevelEffect2D = FlashBevelEffect2D/);
    assert.match(bundle, /exports\.createFlashAuthoredBevelFilter = createFlashAuthoredBevelFilter/);
});
