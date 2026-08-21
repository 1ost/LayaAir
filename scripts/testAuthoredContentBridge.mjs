import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

if (process.env.LAYA_RUN_AUTHORED_BRIDGE_LEAK_DIAGNOSTIC !== "1") {
    throw new Error(
        "test:authored-bridge is quarantined after repeat Node OOMs; " +
        "run focused bridge gates instead. Set LAYA_RUN_AUTHORED_BRIDGE_LEAK_DIAGNOSTIC=1 only for isolated leak diagnosis."
    );
}

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-authored-bridge-tests-"));
const output = join(temporaryDirectory, "authored-bridge.test.mjs");

try {
    await build({
        entryPoints: [join(root, "tests/extensions/authoredContentBridge/authored-bridge.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: {
            js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};"
        },
        loader: {
            ".glsl": "text",
            ".vs": "text",
            ".fs": "text"
        },
        sourcemap: "inline",
        logLevel: "warning"
    });

    const result = spawnSync(process.execPath, ["--max-old-space-size=512", "--test", output], {
        cwd: root,
        stdio: "inherit",
        timeout: 30_000,
    });
    if (result.error)
        throw result.error;
    process.exitCode = result.status ?? 1;
    if (process.exitCode === 0) {
        const authorityRelative = "docTool/architecture/flash-runtime-type-predicates.json";
        const authorityText = await readFile(join(root, authorityRelative), "utf8");
        const expectedHash = (await readFile(join(root,
            "docTool/architecture/flash-runtime-type-predicates.sha256"), "utf8")).trim().split(/\s+/)[0];
        const actualHash = crypto.createHash("sha256")
            .update(authorityText.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
        if (actualHash !== expectedHash) throw new Error("Flash runtime type predicate authority hash drift");
        const authority = JSON.parse(authorityText);
        const expectedSourceQNames = [
            "flash.accessibility.AccessibilityProperties",
            "flash.display.Bitmap",
            "flash.display.BitmapData",
            "flash.display.DisplayObject",
            "flash.display.DisplayObjectContainer",
            "flash.display.Graphics",
            "flash.display.InteractiveObject",
            "flash.display.Loader",
            "flash.display.LoaderInfo",
            "flash.display.MovieClip",
            "flash.display.Shape",
            "flash.display.SimpleButton",
            "flash.display.Sprite",
            "flash.display.Stage",
            "flash.events.ContextMenuEvent",
            "flash.events.ErrorEvent",
            "flash.events.Event",
            "flash.events.EventDispatcher",
            "flash.events.FocusEvent",
            "flash.events.HTTPStatusEvent",
            "flash.events.IOErrorEvent",
            "flash.events.KeyboardEvent",
            "flash.events.MouseEvent",
            "flash.events.ProgressEvent",
            "flash.events.SecurityErrorEvent",
            "flash.events.TextEvent",
            "flash.events.TimerEvent",
            "flash.events.UncaughtErrorEvent",
            "flash.filters.BlurFilter",
            "flash.filters.ColorMatrixFilter",
            "flash.filters.DropShadowFilter",
            "flash.filters.GlowFilter",
            "flash.filters.GradientBevelFilter",
            "flash.geom.ColorTransform",
            "flash.geom.Matrix",
            "flash.geom.Point",
            "flash.geom.Rectangle",
            "flash.geom.Transform",
            "flash.net.FileReference",
            "flash.net.LocalConnection",
            "flash.net.SharedObject",
            "flash.net.Socket",
            "flash.net.URLLoader",
            "flash.net.URLRequest",
            "flash.net.URLVariables",
            "flash.text.StaticText",
            "flash.text.TextField",
            "flash.ui.ContextMenu",
            "flash.ui.ContextMenuItem",
            "flash.utils.Timer",
        ];
        const actualSourceQNames = authority.types.map(entry => entry.sourceQName);
        if (authority.schema !== "laya-flash-runtime-type-predicates@1"
            || authority.hashMode !== "canonical-lf-utf8"
            || JSON.stringify(actualSourceQNames) !== JSON.stringify(expectedSourceQNames))
            throw new Error("Flash runtime type predicate authority is incomplete");
        const rootBarrel = await readFile(join(root, "src/layaAir/flash/index.ts"), "utf8");
        for (const entry of authority.types) {
            const source = await readFile(join(root, entry.targetModule), "utf8");
            const moduleHash = crypto.createHash("sha256")
                .update(source.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
            if (moduleHash !== entry.moduleSha256 || !entry.constructorSignature
                || !Array.isArray(entry.constructSignatures) || entry.constructSignatures.length !== 1
                || !entry.predicateSignature.includes("unknown") || !entry.predicateSignature.includes(" is "))
                throw new Error(`Flash runtime type predicate authority drift: ${entry.sourceQName}`);
            if (rootBarrel.includes(entry.predicateExport))
                throw new Error(`Flash runtime predicate leaked through root barrel: ${entry.predicateExport}`);
            const privateNominalMint = source.includes("new WeakSet<object>()") && source.includes(".add(this)")
                || source.includes("new WeakMap<object,") && source.includes(".set(this,");
            if (!source.includes(`export function ${entry.predicateExport}(`) || !privateNominalMint)
                throw new Error(`Flash runtime nominal proof is not privately minted: ${entry.sourceQName}`);
        }
        const files = [
            "src/layaAir/flash/display/Bitmap.ts",
            "src/layaAir/flash/display/BitmapData.ts",
            "src/layaAir/flash/display/BitmapDataChannel.ts",
            "src/layaAir/flash/display/PixelSnapping.ts",
            "src/layaAir/flash/events/ContextMenuEvent.ts",
            "src/layaAir/flash/events/FlashEventRouter.ts",
            "src/layaAir/flash/events/HTTPStatusEvent.ts",
            "src/layaAir/flash/events/ProgressEvent.ts",
            "src/layaAir/flash/events/SecurityErrorEvent.ts",
            "src/layaAir/flash/events/UncaughtErrorEvent.ts",
            "src/layaAir/flash/display/MovieClip.ts",
            "src/layaAir/flash/display/SimpleButton.ts",
            "src/layaAir/flash/text/TextField.ts",
            "src/extensions/authoredContent/runtime/AuthoredCodeBindings.ts",
            "src/extensions/authoredContent/runtime/LayaAuthoredBindingHost.ts"
        ];
        const combined = (await Promise.all(files.map(file => readFile(join(root, file), "utf8")))).join("\n");
        for (const forbidden of ["createSourceApi", "transpileAs3Subset", "@bleach/flash-compat", "eval(", "new Function"])
            if (combined.includes(forbidden)) throw new Error(`forbidden canonical runtime surface: ${forbidden}`);
    }
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
