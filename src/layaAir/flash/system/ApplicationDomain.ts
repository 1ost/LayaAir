import {
    getDefinitionByName,
    getRegisteredDefinitionNames,
    hasDefinitionByName,
    registerDefinitionByName,
    type NativeDefinition,
} from "../utils/DefinitionRegistry";

function normalizeDefinitionName(value: string): string {
    const name = String(value);
    if (name.includes("::"))
        return name;
    const separator = name.lastIndexOf(".");
    return separator < 0
        ? name
        : `${name.slice(0, separator)}::${name.slice(separator + 1)}`;
}

function requireDefinitionName(value: string): string {
    if (value == null)
        throw new TypeError("definition name must not be null");
    return normalizeDefinitionName(value);
}

/**
 * Native Flash-shaped definition scope.
 *
 * The root domain projects LayaAir's finite native definition registry. Child
 * domains may register authored linkage constructors locally and fall back to
 * their parent without copying or executing legacy bytecode.
 */
export class ApplicationDomain {
    private static readonly root = new ApplicationDomain(null);

    private readonly definitions = new Map<string, NativeDefinition>();
    private readonly definitionNames = new Set<string>();
    private readonly _parentDomain: ApplicationDomain | null;
    private readonly projectsNativeRegistry: boolean;

    constructor(parentDomain: ApplicationDomain | null = null) {
        this.projectsNativeRegistry = ApplicationDomain.root == null;
        this._parentDomain = this.projectsNativeRegistry
            ? null
            : parentDomain ?? ApplicationDomain.currentDomain;
    }

    static get currentDomain(): ApplicationDomain {
        return ApplicationDomain.root;
    }

    get parentDomain(): ApplicationDomain | null {
        return this._parentDomain;
    }

    hasDefinition(name: string): boolean {
        if (name == null)
            return false;
        const definitionKey = normalizeDefinitionName(name);
        if (this.definitions.has(definitionKey))
            return true;
        if (this.projectsNativeRegistry && hasDefinitionByName(definitionKey))
            return true;
        return this._parentDomain?.hasDefinition(definitionKey) ?? false;
    }

    getDefinition(name: string): NativeDefinition {
        const definitionKey = requireDefinitionName(name);
        const local = this.definitions.get(definitionKey);
        if (local != null)
            return local;
        if (this.projectsNativeRegistry && hasDefinitionByName(definitionKey))
            return getDefinitionByName(definitionKey);
        if (this._parentDomain != null)
            return this._parentDomain.getDefinition(definitionKey);
        throw new ReferenceError(`Definition ${definitionKey} could not be found.`);
    }

    /** Loader/authored-content integration seam for native linkage classes. */
    registerDefinition(name: string, definition: NativeDefinition): void {
        const definitionKey = requireDefinitionName(name);
        if (typeof definition !== "function")
            throw new TypeError("definition must be a constructor or function");

        const previous = this.definitions.get(definitionKey);
        if (previous != null && previous !== definition)
            throw new Error(`Definition ${definitionKey} already has a different identity.`);
        if (previous === definition)
            return;

        this.definitions.set(definitionKey, definition);
        this.definitionNames.add(definitionKey);
        if (this.projectsNativeRegistry)
            registerDefinitionByName(definitionKey, definition);
    }

    getQualifiedDefinitionNames(): string[] {
        const names = new Set(this.definitionNames);
        if (this.projectsNativeRegistry) {
            for (const name of getRegisteredDefinitionNames())
                names.add(name);
        }
        return [...names].sort();
    }
}
