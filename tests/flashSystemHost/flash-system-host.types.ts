import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import { ExternalInterface } from "../../src/layaAir/flash/external/ExternalInterface";
import type { NativeExternalInterfaceHost, NativeExternalInterfaceHostLease }
    from "../../src/layaAir/flash/external/ExternalInterface";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy";
import { System } from "../../src/layaAir/flash/system/System";
import type { NativeSystemHost, NativeSystemHostLease } from "../../src/layaAir/flash/system/System";

const version: string = Capabilities.version;
const debugging: boolean = Capabilities.isDebugger;
const policy: string = ImageDecodingPolicy.ON_LOAD;
const available: boolean = ExternalInterface.available;
const result: unknown = ExternalInterface.call("host.call", 1);
// @ts-expect-error host protocol admits only immutable primitive values
ExternalInterface.call("host.call", { mutable: true });
const memory: number = System.totalMemory;
const error: Error = new IllegalOperationError("message", 1);
type Hosts = readonly [NativeExternalInterfaceHost, NativeSystemHost];
type Leases = readonly [NativeExternalInterfaceHostLease, NativeSystemHostLease];

// @ts-expect-error bootstrap leases are engine-issued and structurally opaque
const forgedExternalLease: NativeExternalInterfaceHostLease = { active: true, disposed: false, dispose() {} };
// @ts-expect-error bootstrap leases are engine-issued and structurally opaque
const forgedSystemLease: NativeSystemHostLease = { active: true, disposed: false, dispose() {} };

void [version, debugging, policy, available, result, memory, error] satisfies readonly unknown[];
void (false as boolean satisfies (Hosts extends readonly unknown[] ? boolean : never));
void (false as boolean satisfies (Leases extends readonly unknown[] ? boolean : never));
void [forgedExternalLease, forgedSystemLease];
