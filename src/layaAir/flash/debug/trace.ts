/**
 * Flash global trace bridge.
 *
 * Values are forwarded as one host console call so object identity and native
 * formatting remain observable. Applications decide whether to invoke trace;
 * the bridge does not invent a build-profile filter.
 */
export function trace(...values: unknown[]): void {
    globalThis.console.log(...values);
}
