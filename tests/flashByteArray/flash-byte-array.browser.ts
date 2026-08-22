import { ByteArray, ZlibDecompressionHost } from "../../src/layaAir/flash/utils/ByteArray";

const ZLIB_BLEACH_NUL_BROWSER = new Uint8Array([
    120, 156, 115, 202, 73, 77, 76, 206, 96, 72, 42, 202,
    47, 47, 78, 45, 2, 0, 37, 137, 5, 68
]);
const ZLIB_BLEACH_MAP_SYNC = new Uint8Array([
    120, 156, 115, 202, 73, 77, 76, 206, 80, 200, 77, 44, 80,
    40, 174, 204, 75, 86, 72, 42, 202, 76, 73, 79, 5, 0, 90, 126, 8, 8
]);

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function snapshot(value: ByteArray): number[] {
    return [...new Uint8Array(value.buffer)];
}

function positionOf(value: ByteArray): number {
    return value.position;
}

async function rejected(promise: Promise<unknown>, expected: (error: unknown) => boolean): Promise<void> {
    try {
        await promise;
    } catch (error) {
        requireValue(expected(error), `Unexpected rejection: ${String(error)}`);
        return;
    }
    throw new Error("Expected promise rejection");
}

async function run(): Promise<Record<string, unknown>> {
    const defaultCapability = typeof globalThis.DecompressionStream === "function";
    requireValue(defaultCapability, "Supported Chromium lacks DecompressionStream");

    const transferSource = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    transferSource.position = 1;
    const transferTarget = new ByteArray(new Uint8Array([9]));
    transferTarget.position = 1;
    transferSource.readBytes(transferTarget, 3);
    requireValue(JSON.stringify(snapshot(transferTarget)) === "[9,0,0,2,3,4]"
        && positionOf(transferTarget) === 1 && positionOf(transferSource) === 4,
        "Browser readBytes transfer mismatch");
    transferTarget.writeBytes(transferTarget, 0, 3);
    requireValue(JSON.stringify(snapshot(transferTarget)) === "[9,9,0,0,3,4]"
        && positionOf(transferTarget) === 4,
        "Browser writeBytes self-overlap mismatch");

    const decoded = new ByteArray(ZLIB_BLEACH_NUL_BROWSER);
    await decoded.uncompressZlib();
    requireValue(decoded.readUTFBytes() === "Bleach\0browser", "Default browser zlib decode mismatch");

    const synchronous = new ByteArray(ZLIB_BLEACH_MAP_SYNC);
    synchronous.position = synchronous.length;
    synchronous.uncompress();
    requireValue(synchronous.position === 0 && synchronous.readUTFBytes() === "Bleach map sync bridge",
        "Synchronous browser zlib decode mismatch");
    const corruptSynchronous = new ByteArray(ZLIB_BLEACH_MAP_SYNC.map((value, index) =>
        index === ZLIB_BLEACH_MAP_SYNC.length - 1 ? value ^ 1 : value));
    const corruptSnapshot = JSON.stringify(snapshot(corruptSynchronous));
    let syncRejected = false;
    try { corruptSynchronous.uncompress(); } catch { syncRejected = true; }
    requireValue(syncRejected && JSON.stringify(snapshot(corruptSynchronous)) === corruptSnapshot,
        "Malformed synchronous browser decode partially committed");

    const malformed = new ByteArray(new Uint8Array([1, 2, 3, 4]));
    malformed.position = 2;
    await rejected(malformed.uncompressZlib(), () => true);
    requireValue(JSON.stringify(snapshot(malformed)) === "[1,2,3,4]" && malformed.position === 2,
        "Malformed browser decode partially committed");

    const cancelled = new ByteArray(ZLIB_BLEACH_NUL_BROWSER);
    cancelled.position = 1;
    const controller = new AbortController();
    const cancellation = cancelled.uncompressZlib(undefined, controller.signal);
    controller.abort(new DOMException("browser cancellation", "AbortError"));
    await rejected(cancellation, error => error instanceof DOMException && error.name === "AbortError");
    requireValue(JSON.stringify(snapshot(cancelled)) === JSON.stringify([...ZLIB_BLEACH_NUL_BROWSER])
        && cancelled.position === 1, "Cancelled browser decode partially committed");

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
    requireValue(descriptor?.configurable, "Browser DecompressionStream capability cannot be isolated for fallback test");
    const fallback = new ByteArray(new Uint8Array([8, 9]));
    try {
        Object.defineProperty(globalThis, "DecompressionStream", {
            configurable: true, writable: true, value: undefined
        });
        await rejected(fallback.uncompressZlib(), error =>
            error instanceof Error && error.message.includes("does not provide"));
        requireValue(JSON.stringify(snapshot(fallback)) === "[8,9]",
            "Missing default capability changed the receiver");
        const injected: ZlibDecompressionHost = {
            async decompressZlib(): Promise<ArrayBuffer> {
                return new TextEncoder().encode("injected fallback").buffer;
            }
        };
        await fallback.uncompressZlib(injected);
        requireValue(fallback.readUTFBytes() === "injected fallback", "Injected browser fallback failed");
    } finally {
        Object.defineProperty(globalThis, "DecompressionStream", descriptor);
    }

    return {
        defaultCapability,
        transferPrimitives: true,
        defaultSuccess: true,
        synchronousSuccess: true,
        malformedNoCommit: true,
        cancellationNoCommit: true,
        missingCapabilityRejects: true,
        injectedFallback: true,
    };
}

void run().then(result => publish({ ok: true, result }), error => publish({
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error)
}));

function publish(payload: unknown): void {
    const marker = document.createElement("pre");
    marker.id = "flash-byte-array-browser-result";
    marker.textContent = JSON.stringify(payload);
    document.body.appendChild(marker);
}
