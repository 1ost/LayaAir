import { IllegalOperationError } from "../../src/layaAir/flash/errors/IllegalOperationError";
import { ExternalInterface, NativeExternalInterfaceHost } from "../../src/layaAir/flash/external/ExternalInterface";
import { Capabilities } from "../../src/layaAir/flash/system/Capabilities";
import { ImageDecodingPolicy } from "../../src/layaAir/flash/system/ImageDecodingPolicy";
import { NativeSystemHost, System } from "../../src/layaAir/flash/system/System";

const version: string = Capabilities.version;
const debugging: boolean = Capabilities.isDebugger;
const policy: string = ImageDecodingPolicy.ON_LOAD;
const available: boolean = ExternalInterface.available;
const result: unknown = ExternalInterface.call("host.call", 1);
const memory: number = System.totalMemory;
const error: Error = new IllegalOperationError("message", 1);
type Hosts = readonly [NativeExternalInterfaceHost, NativeSystemHost];

void [version, debugging, policy, available, result, memory, error] satisfies readonly unknown[];
void (false as boolean satisfies (Hosts extends readonly unknown[] ? boolean : never));
