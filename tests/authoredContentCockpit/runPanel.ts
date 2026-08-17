import { AuthoredContentCockpitBridgeClient } from "../../src/extensions/authoredContent/cockpit/AuthoredContentCockpitBridge";
import { AuthoredAsyncEpoch, captureFocusedWidgetName, restoreNamedFocus } from "../../src/extensions/authoredContent/cockpit/AuthoredContentCockpitPanelSupport";
import { AuthoredPreviewCanvasController } from "../../src/extensions/authoredContent/cockpit/AuthoredPreviewCanvasController";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}

async function main(): Promise<void> {
    const calls: Array<{ command: string; parameters: unknown[] }> = [];
    const bridge = new AuthoredContentCockpitBridgeClient(async (command, ...parameters) => {
        calls.push({ command, parameters });
        if (command.endsWith("resolvePreview"))
            return { assetId: "native-prefab-id" };
        if (command.endsWith("getSnapshot"))
            return { marker: "snapshot" };
        return { message: "done" };
    });
    await bridge.getSnapshot();
    await bridge.resolvePreview({ familyId: "family/menu", symbolId: "symbol/play", locale: "ja-JP", previewLayer: "final" });
    await bridge.runAction("detach", { action: "detach", familyId: "family/menu", symbolId: "symbol/play", locale: "ja-JP", previewLayer: "final" });
    assert(calls.map(call => call.command).join("|") === [
        "AuthoredContentCockpitSceneBridge.getSnapshot",
        "AuthoredContentCockpitSceneBridge.resolvePreview",
        "AuthoredContentCockpitSceneBridge.detach"
    ].join("|"), "panel bridge must preserve exact Scene-process command names");
    assert((calls[2].parameters[0] as { symbolId: string }).symbolId === "symbol/play", "detach must pass the captured target");
    console.log("PASS panel bridge integration seam and exact detach request");

    const epoch = new AuthoredAsyncEpoch();
    const first = epoch.begin();
    const second = epoch.begin();
    assert(!epoch.isCurrent(first), "older async panel completion must become stale");
    assert(epoch.isCurrent(second), "latest async panel completion must remain current");
    epoch.destroy();
    assert(!epoch.isCurrent(second), "destroyed panel must reject pending completion");
    assert(epoch.begin() === -1, "destroyed panel must reject new async work");
    console.log("PASS panel async completion and destroyed-state guards");

    let focusedName: string | undefined;
    const symbol = mockWidget("symbol:symbol/options", true, [], () => { focusedName = "symbol:symbol/options"; });
    const root = mockWidget("cockpit-root", false, [mockWidget("family:family/menu", false), symbol]);
    assert(captureFocusedWidgetName(root) === "symbol:symbol/options", "focused semantic widget name must be captured");
    const replacementRoot = mockWidget("cockpit-root", false, [
        mockWidget("family:family/menu", false),
        mockWidget("symbol:symbol/options", false, [], () => { focusedName = "symbol:symbol/options"; })
    ]);
    assert(restoreNamedFocus(replacementRoot, "symbol:symbol/options"), "semantic focus must be restored after rerender");
    assert(focusedName === "symbol:symbol/options", "focus restore must target the same symbol control");
    console.log("PASS panel focus preservation across destructive list rerender");

    await testPreviewInterleaving();
}

async function testPreviewInterleaving(): Promise<void> {
    const resolveA = deferred<{ assetId: string }>();
    const resolveCanvas = new ControllableCanvas();
    const resolveController = new AuthoredPreviewCanvasController(resolveCanvas.asCanvas(), "AuthoredContentPreviewScene");
    let desired = "A";
    const staleResolve = resolveController.resolveAndPresent(() => resolveA.promise, () => desired === "A");
    desired = "B";
    const currentResolve = resolveController.resolveAndPresent(async () => ({ assetId: "B" }), () => desired === "B");
    assert(await currentResolve === "presented", "B must present while A resolution is pending");
    resolveA.resolve({ assetId: "A" });
    assert(await staleResolve === "stale", "late A resolution must be discarded");
    assert(resolveCanvas.assetId === "B", "late A resolution must not release B");
    assert(!resolveCanvas.events.includes("release:B"), "stale resolve must never clear newer B");

    const createCanvas = new ControllableCanvas();
    const createController = new AuthoredPreviewCanvasController(createCanvas.asCanvas(), "AuthoredContentPreviewScene");
    const createAGate = createCanvas.blockCreate("A");
    desired = "A";
    const staleCreate = createController.resolveAndPresent(async () => ({ assetId: "A" }), () => desired === "A");
    await createCanvas.createStarted("A");
    desired = "B";
    const currentCreate = createController.resolveAndPresent(async () => ({ assetId: "B" }), () => desired === "B");
    createAGate.resolve();
    assert(await staleCreate === "stale", "A that becomes stale during create must be discarded under the mutation lock");
    assert(await currentCreate === "presented", "B must present after serialized stale-A cleanup");
    assert(createCanvas.assetId === "B", "serialized create cleanup must leave B displayed");
    assert(!createCanvas.events.includes("release:B"), "stale A create must never release B");

    const releaseCanvas = new ControllableCanvas("X");
    const releaseController = new AuthoredPreviewCanvasController(releaseCanvas.asCanvas(), "AuthoredContentPreviewScene");
    const releaseXGate = releaseCanvas.blockRelease("X");
    desired = "A";
    const staleRelease = releaseController.resolveAndPresent(async () => ({ assetId: "A" }), () => desired === "A");
    await releaseCanvas.releaseStarted("X");
    desired = "B";
    const currentAfterRelease = releaseController.resolveAndPresent(async () => ({ assetId: "B" }), () => desired === "B");
    releaseXGate.resolve();
    assert(await staleRelease === "stale", "A that becomes stale during release must not create");
    assert(await currentAfterRelease === "presented", "B must present after serialized release");
    assert(releaseCanvas.assetId === "B", "serialized release must leave B displayed");
    assert(!releaseCanvas.events.includes("release:B"), "stale release completion must never clear B");
    console.log("PASS real panel preview controller serializes out-of-order resolve/create/release without clearing B");
}

class ControllableCanvas {
    readonly events: string[] = [];
    assetId?: string;
    private readonly createGates = new Map<string, Deferred<void>>();
    private readonly releaseGates = new Map<string, Deferred<void>>();
    private readonly createStarts = new Map<string, Deferred<void>>();
    private readonly releaseStarts = new Map<string, Deferred<void>>();

    constructor(assetId?: string) {
        this.assetId = assetId;
    }

    get ready(): boolean {
        return this.assetId !== undefined;
    }

    blockCreate(assetId: string): Deferred<void> {
        const gate = deferred<void>();
        this.createGates.set(assetId, gate);
        return gate;
    }

    blockRelease(assetId: string): Deferred<void> {
        const gate = deferred<void>();
        this.releaseGates.set(assetId, gate);
        return gate;
    }

    createStarted(assetId: string): Promise<void> {
        let started = this.createStarts.get(assetId);
        if (!started) {
            started = deferred<void>();
            this.createStarts.set(assetId, started);
        }
        return started.promise;
    }

    releaseStarted(assetId: string): Promise<void> {
        let started = this.releaseStarts.get(assetId);
        if (!started) {
            started = deferred<void>();
            this.releaseStarts.set(assetId, started);
        }
        return started.promise;
    }

    async createObject(_scriptName: string, _initMethod?: string, ...args: unknown[]): Promise<void> {
        const assetId = String(args[0]);
        this.events.push(`create-start:${assetId}`);
        this.signal(this.createStarts, assetId);
        const gate = this.createGates.get(assetId);
        if (gate)
            await gate.promise;
        this.assetId = assetId;
        this.events.push(`create-end:${assetId}`);
    }

    async releaseObject(): Promise<void> {
        const assetId = this.assetId;
        if (!assetId)
            return;
        this.events.push(`release-start:${assetId}`);
        this.signal(this.releaseStarts, assetId);
        const gate = this.releaseGates.get(assetId);
        if (gate)
            await gate.promise;
        this.events.push(`release:${assetId}`);
        if (this.assetId === assetId)
            this.assetId = undefined;
    }

    asCanvas(): IEditor.IRender3DCanvas {
        return this as unknown as IEditor.IRender3DCanvas;
    }

    private signal(map: Map<string, Deferred<void>>, assetId: string): void {
        let started = map.get(assetId);
        if (!started) {
            started = deferred<void>();
            map.set(assetId, started);
        }
        started.resolve();
    }
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(accept => { resolve = accept; });
    return { promise, resolve };
}

function mockWidget(name: string, focused: boolean, children: gui.Widget[] = [], onFocus: () => void = () => {}): gui.Widget {
    return {
        name,
        focused,
        children,
        visible: true,
        enabled: true,
        focusable: true,
        requestFocus: onFocus
    } as unknown as gui.Widget;
}

void main();
