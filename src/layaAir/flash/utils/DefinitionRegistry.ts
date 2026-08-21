export type NativeDefinition = Function;

const definitions = new Map<string, NativeDefinition>();

function normalizeDefinitionName(value: string): string {
    const name = String(value);
    if (name.includes("::"))
        return name;
    const lastDot = name.lastIndexOf(".");
    return lastDot < 0 ? name : `${name.slice(0, lastDot)}::${name.slice(lastDot + 1)}`;
}

export function registerDefinitionByName(name: string, definition: NativeDefinition): void {
    if (typeof definition !== "function")
        throw new TypeError("definition must be a constructor or function");
    definitions.set(normalizeDefinitionName(name), definition);
}

export function registerObservedDefinition(name: string, definition: NativeDefinition): void {
    const key = normalizeDefinitionName(name);
    if (!definitions.has(key))
        definitions.set(key, definition);
}

export function getDefinitionByName(name: string): NativeDefinition {
    const key = normalizeDefinitionName(name);
    const definition = definitions.get(key);
    if (!definition)
        throw new ReferenceError(`Definition ${key} could not be found.`);
    return definition;
}

export function hasDefinitionByName(name: string): boolean {
    return definitions.has(normalizeDefinitionName(name));
}

export function getRegisteredDefinitionNames(): string[] {
    return [...definitions.keys()].sort();
}

for (const definition of [
    Object, Array, String, Number, Boolean, Date, Function, Error, RegExp, Promise,
]) registerObservedDefinition(definition.name, definition);
