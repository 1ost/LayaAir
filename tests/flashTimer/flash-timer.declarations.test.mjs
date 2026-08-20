import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated LayaFlash declarations expose only the five timer function names", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    assert.doesNotMatch(declaration, /\bFlashTimerCallback\b/);
    for (const name of ["getTimer", "setTimeout", "clearTimeout", "setInterval", "clearInterval"])
        assert.match(declaration, new RegExp(`\\bfunction ${name}\\b`));
});
