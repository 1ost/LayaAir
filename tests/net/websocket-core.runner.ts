(<any>globalThis).window = globalThis;
(<any>globalThis).document = {};

await import("./websocket-core.test");

export { };
