import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { ApplicationDomain } from "./ApplicationDomain";
import { ImageDecodingPolicy } from "./ImageDecodingPolicy";

const LOADER_CONTEXT_VALUES = new WeakSet<object>();

export interface NativeLoaderContextSnapshot {
    readonly checkPolicyFile: boolean;
    readonly applicationDomain: ApplicationDomain | null;
    readonly imageDecodingPolicy: string;
    readonly parameters: Readonly<Record<string, unknown>> | null;
}

/** Flash-shaped policy for native Loader operations; executable bytecode remains forbidden. */
export class LoaderContext {
    checkPolicyFile: boolean;
    applicationDomain: ApplicationDomain | null;
    securityDomain: unknown | null;
    allowCodeImport = false;
    imageDecodingPolicy = ImageDecodingPolicy.ON_DEMAND;
    parameters: Record<string, unknown> | null = null;
    requestedContentParent: unknown | null = null;

    constructor(
        checkPolicyFile = false,
        applicationDomain: ApplicationDomain | null = null,
        securityDomain: unknown | null = null,
    ) {
        this.checkPolicyFile = Boolean(checkPolicyFile);
        this.applicationDomain = applicationDomain;
        this.securityDomain = securityDomain;
        LOADER_CONTEXT_VALUES.add(this);
    }

    get allowLoadBytesCodeExecution(): boolean { return this.allowCodeImport; }
    set allowLoadBytesCodeExecution(value: boolean) { this.allowCodeImport = Boolean(value); }
}

/** @internal Captures the non-executable subset admitted by native hierarchy loading. */
export function snapshotNativeLoaderContext(context: LoaderContext): NativeLoaderContextSnapshot {
    if (typeof context !== "object" || context === null || !LOADER_CONTEXT_VALUES.has(context))
        throw new TypeError("Loader context must be a canonical LoaderContext");
    if (context.applicationDomain !== null && !(context.applicationDomain instanceof ApplicationDomain))
        throw new TypeError("LoaderContext.applicationDomain must be a canonical ApplicationDomain");
    if (context.securityDomain !== null)
        throw new UnsupportedFlashFeatureError(
            "flash.system.LoaderContext.securityDomain",
            "native hierarchy loading does not admit Flash security domains",
        );
    if (context.allowCodeImport)
        throw new UnsupportedFlashFeatureError(
            "flash.system.LoaderContext.allowCodeImport",
            "runtime executable code import is forbidden",
        );
    if (context.imageDecodingPolicy !== ImageDecodingPolicy.ON_DEMAND
        && context.imageDecodingPolicy !== ImageDecodingPolicy.ON_LOAD)
        throw new TypeError("LoaderContext.imageDecodingPolicy is invalid");
    const parameters = context.parameters === null
        ? null
        : Object.freeze({ ...context.parameters });
    return Object.freeze({
        checkPolicyFile: Boolean(context.checkPolicyFile),
        applicationDomain: context.applicationDomain,
        imageDecodingPolicy: context.imageDecodingPolicy,
        parameters,
    });
}

/** @internal Nominal proof for loader admission. */
export function isFlashLoaderContext(value: unknown): value is LoaderContext {
    return typeof value === "object" && value !== null && LOADER_CONTEXT_VALUES.has(value);
}
