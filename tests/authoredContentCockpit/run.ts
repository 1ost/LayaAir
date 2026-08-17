import { AuthoredContentCockpitModel } from "../../src/extensions/authoredContent/cockpit/AuthoredContentCockpitModel";
import { AuthoredCockpitSnapshot } from "../../src/extensions/authoredContent/cockpit/AuthoredContentCockpitTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function assertThrows(callback: () => void, pattern: RegExp, message: string): void {
    try {
        callback();
    } catch (error) {
        assert(pattern.test(String(error)), `${message}: wrong error ${String(error)}`);
        return;
    }
    throw new Error(`${message}: expected an error`);
}

function fixture(): AuthoredCockpitSnapshot {
    return {
        families: [
            {
                id: "family/menu",
                label: "Menu",
                symbols: [
                    { id: "symbol/play", label: "Play", kind: "movie-clip", status: "ready" },
                    { id: "symbol/options", label: "Options", kind: "movie-clip", status: "warning" }
                ]
            },
            {
                id: "family/hud",
                label: "HUD",
                symbols: [{ id: "symbol/health", label: "Health", kind: "movie-clip", status: "error" }]
            }
        ],
        locales: ["en-US", "ja-JP", "de-DE"],
        selectedFamilyId: "family/menu",
        selectedSymbolId: "symbol/options",
        selectedLocale: "ja-JP",
        previewLayer: "base",
        sourcePath: "assets/authored/menu.swfxml",
        obligations: [
            { id: "ob/global", kind: "compatibility", severity: "info", label: "Frame rate", details: "Retained globally" },
            { id: "ob/options", kind: "binding", severity: "warning", label: "Instance binding", details: "Resolve playButton", targetSymbolId: "symbol/options" },
            { id: "ob/health", kind: "binding", severity: "error", label: "Health binding", details: "Resolve bar", targetSymbolId: "symbol/health" },
            {
                id: "ob/flash-shape",
                kind: "flash-bridge",
                severity: "warning",
                label: "Timeline callback shape",
                details: "Preserve the observable callback contract in native code",
                targetSymbolId: "symbol/options",
                flashShape: { sourceShape: "MovieClip frame callback", nativeContract: "Laya timeline event" }
            }
        ],
        conflicts: [
            { id: "conf/options", severity: "warning", label: "Options text", details: "Locale patch changed", targetSymbolId: "symbol/options", locale: "ja-JP" },
            { id: "conf/health", severity: "error", label: "Health transform", details: "Project patch diverged", targetSymbolId: "symbol/health", locale: "de-DE" }
        ]
    };
}

const tests: Array<{ name: string; run: () => void }> = [
    {
        name: "normalizes and preserves explicit selection",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            assertEqual(model.selectedFamilyId, "family/menu", "family selection");
            assertEqual(model.selectedSymbolId, "symbol/options", "symbol selection");
            assertEqual(model.selectedLocale, "ja-JP", "locale selection");
            assertEqual(model.previewLayer, "base", "preview selection");
        }
    },
    {
        name: "selects only exact symbol locale and layer values",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            assertThrows(() => model.selectFamily("family/hud"), /cannot choose a default symbol/, "family cannot pick a fallback symbol");
            model.selectSymbol("symbol/health");
            model.selectLocale("de-DE");
            model.selectPreviewLayer("final");
            assertEqual(model.selectedLocale, "de-DE", "selected locale");
            assertEqual(model.previewLayer, "final", "selected layer");
            assertThrows(() => model.selectSymbol("missing"), /Unknown authored-content symbol/, "unknown symbol");
            assertThrows(() => model.selectLocale("fr-FR"), /Unknown authored-content locale/, "unknown locale");
        }
    },
    {
        name: "filters compatibility and binding obligations by symbol",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            assertEqual(model.visibleObligations().length, 3, "global plus selected obligations");
            model.selectSymbol("symbol/health");
            const visible = model.visibleObligations();
            assertEqual(visible.length, 2, "global plus health obligation");
            assert(visible.some(value => value.id === "ob/health"), "health binding must be visible");
            assert(!visible.some(value => value.id === "ob/options"), "options binding must be hidden");
        }
    },
    {
        name: "navigates conflicts cyclically and selects their exact target locale",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            assertEqual(model.navigateConflict(1)?.id, "conf/options", "first conflict");
            assertEqual(model.selectedSymbolId, "symbol/options", "first target");
            assertEqual(model.navigateConflict(1)?.id, "conf/health", "second conflict");
            assertEqual(model.selectedSymbolId, "symbol/health", "second target");
            assertEqual(model.selectedLocale, "de-DE", "conflict target locale");
            assertEqual(model.navigateConflict(1)?.id, "conf/options", "wrap forward");
            assertEqual(model.navigateConflict(-1)?.id, "conf/health", "wrap backward");
        }
    },
    {
        name: "models progress success error and excludes concurrent actions",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            model.beginAction("render", "Rendering");
            model.reportProgress(1.4, "Almost done");
            assertEqual(model.actionStatus.progress, 1, "progress upper clamp");
            assertThrows(() => model.beginAction("validate", "Validating"), /still running/, "concurrent action");
            model.finishAction("Rendered");
            assertEqual(model.actionStatus.state, "success", "success state");
            model.failAction("Render failed");
            assertEqual(model.actionStatus.state, "error", "error state");
            assertEqual(model.actionStatus.message, "Render failed", "error message");
        }
    },
    {
        name: "captures and revalidates the exact detach target",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            const capture = model.captureAction("detach");
            const request = capture.request;
            assertEqual(request.action, "detach", "action");
            assertEqual(request.familyId, "family/menu", "request family");
            assertEqual(request.symbolId, "symbol/options", "request symbol");
            assertEqual(request.locale, "ja-JP", "request locale");
            assertEqual(request.previewLayer, "base", "request layer");
            assertEqual(capture.symbolLabel, "Options", "detach target name");
            assert(model.isCaptureCurrent(capture), "new capture must be current");
            model.selectLocale("de-DE");
            assert(!model.isCaptureCurrent(capture), "locale change must stale the capture");
        }
    },
    {
        name: "maps all documented keyboard commands",
        run: () => {
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("Ctrl + O")?.kind, "open-xml", "open XML hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("CTRL+R")?.kind, "action", "reimport hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("alt+1")?.kind, "preview-layer", "source hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("alt+2")?.kind, "preview-layer", "base hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("alt+3")?.kind, "preview-layer", "final hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("f8")?.kind, "conflict", "next conflict hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("shift+f8")?.kind, "conflict", "previous conflict hotkey");
            assertEqual(AuthoredContentCockpitModel.commandForHotkey("ctrl+x"), undefined, "unknown hotkey");
        }
    },
    {
        name: "rejects ambiguous IDs unknown issue targets and stale explicit selections",
        run: () => {
            const duplicate = fixture();
            duplicate.families[1].symbols[0].id = "symbol/options";
            assertThrows(() => new AuthoredContentCockpitModel().load(duplicate), /Duplicate or empty authored-content symbol id/, "duplicate symbols");
            const unknownTarget = fixture();
            unknownTarget.conflicts[0].targetSymbolId = "symbol/missing";
            assertThrows(() => new AuthoredContentCockpitModel().load(unknownTarget), /targets unknown symbol/, "unknown issue target");
            const staleFamily = fixture();
            staleFamily.selectedFamilyId = "family/missing";
            assertThrows(() => new AuthoredContentCockpitModel().load(staleFamily), /Unknown or missing selected authored-content family/, "stale family");
            const staleSymbol = fixture();
            staleSymbol.selectedSymbolId = "symbol/health";
            assertThrows(() => new AuthoredContentCockpitModel().load(staleSymbol), /stale for family/, "symbol from another family");
            const staleLocale = fixture();
            staleLocale.selectedLocale = "fr-FR";
            assertThrows(() => new AuthoredContentCockpitModel().load(staleLocale), /Unknown or missing selected authored-content locale/, "stale locale");
            const missingLayer = fixture();
            delete missingLayer.previewLayer;
            assertThrows(() => new AuthoredContentCockpitModel().load(missingLayer), /Unknown or missing authored-content preview layer/, "missing preview layer");
            const missingLocales = fixture();
            missingLocales.locales = [];
            assertThrows(() => new AuthoredContentCockpitModel().load(missingLocales), /at least one locale/, "missing locales cannot default");
            const missingBridgeShape = fixture();
            delete missingBridgeShape.obligations[3].flashShape;
            assertThrows(() => new AuthoredContentCockpitModel().load(missingBridgeShape), /missing its explicit native contract/, "Flash-shaped obligation contract");
        }
    },
    {
        name: "locks selection while an exact action is running",
        run: () => {
            const model = new AuthoredContentCockpitModel();
            model.load(fixture());
            model.beginAction("reimport", "Reimporting");
            assertThrows(() => model.selectSymbol("symbol/play"), /selection is locked/, "symbol lock");
            assertThrows(() => model.selectLocale("de-DE"), /selection is locked/, "locale lock");
            assertThrows(() => model.selectPreviewLayer("final"), /selection is locked/, "preview lock");
        }
    }
];

for (const test of tests) {
    test.run();
    console.log(`PASS ${test.name}`);
}
console.log(`${tests.length}/${tests.length} authored-content cockpit model tests passed`);
