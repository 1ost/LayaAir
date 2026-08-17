/**
 * ActionScript instance methods are method closures; JavaScript prototype
 * methods are not. The deterministic transpiler emits one binding per method
 * used as a callback so add/removeEventListener observe the same identity.
 */
export function bindAS3Method<T extends object>(instance: T, methodName: string): void {
    const method = (instance as any)[methodName];
    if (typeof method !== "function")
        throw new TypeError(`Cannot bind ActionScript method '${methodName}'`);
    Object.defineProperty(instance, methodName, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: method.bind(instance)
    });
}
