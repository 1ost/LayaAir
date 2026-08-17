import {
    AuthoredActionStatus,
    AuthoredActionCapture,
    AuthoredCockpitAction,
    AuthoredCockpitCommand,
    AuthoredCockpitRequest,
    AuthoredCockpitSelection,
    AuthoredCockpitSnapshot,
    AuthoredConflict,
    AuthoredFamilySummary,
    AuthoredObligation,
    AuthoredPreviewLayer,
    AuthoredSymbolSummary
} from "./AuthoredContentCockpitTypes";

const PREVIEW_LAYERS: ReadonlyArray<AuthoredPreviewLayer> = ["source", "base", "final"];

export class AuthoredContentCockpitModel {
    private _snapshot: AuthoredCockpitSnapshot = {
        families: [],
        locales: [],
        obligations: [],
        conflicts: []
    };
    private _selectedFamilyId?: string;
    private _selectedSymbolId?: string;
    private _selectedLocale = "";
    private _previewLayer: AuthoredPreviewLayer = "final";
    private _activeConflictIndex = -1;
    private _selectionRevision = 0;
    private _actionStatus: AuthoredActionStatus = {
        state: "idle",
        progress: 0,
        message: "Ready"
    };

    get snapshot(): Readonly<AuthoredCockpitSnapshot> {
        return this._snapshot;
    }

    get families(): ReadonlyArray<AuthoredFamilySummary> {
        return this._snapshot.families;
    }

    get locales(): ReadonlyArray<string> {
        return this._snapshot.locales;
    }

    get selectedFamilyId(): string | undefined {
        return this._selectedFamilyId;
    }

    get selectedSymbolId(): string | undefined {
        return this._selectedSymbolId;
    }

    get selectedLocale(): string {
        return this._selectedLocale;
    }

    get previewLayer(): AuthoredPreviewLayer {
        return this._previewLayer;
    }

    get actionStatus(): Readonly<AuthoredActionStatus> {
        return this._actionStatus;
    }

    get busy(): boolean {
        return this._actionStatus.state === "running";
    }

    get selectionRevision(): number {
        return this._selectionRevision;
    }

    get sourcePath(): string | undefined {
        return this._snapshot.sourcePath;
    }

    get selectedSymbol(): AuthoredSymbolSummary | undefined {
        if (!this._selectedSymbolId)
            return undefined;
        for (const family of this._snapshot.families) {
            const symbol = family.symbols.find(value => value.id === this._selectedSymbolId);
            if (symbol)
                return symbol;
        }
        return undefined;
    }

    load(snapshot: AuthoredCockpitSnapshot): void {
        this.validateSnapshot(snapshot);
        this._snapshot = {
            ...snapshot,
            families: snapshot.families.map(family => ({ ...family, symbols: family.symbols.map(symbol => ({ ...symbol })) })),
            locales: [...snapshot.locales],
            obligations: snapshot.obligations.map(obligation => ({ ...obligation })),
            conflicts: snapshot.conflicts.map(conflict => ({ ...conflict }))
        };

        this._selectedFamilyId = snapshot.selectedFamilyId;
        this._selectedSymbolId = snapshot.selectedSymbolId;
        this._selectedLocale = snapshot.selectedLocale!;
        this._previewLayer = snapshot.previewLayer!;
        this._activeConflictIndex = -1;
        this._selectionRevision++;
    }

    selectFamily(familyId: string): void {
        this.assertSelectionUnlocked();
        const family = this.findFamily(familyId);
        if (!family)
            throw new Error(`Unknown authored-content family: ${familyId}`);
        if (!this._selectedSymbolId || !family.symbols.some(symbol => symbol.id === this._selectedSymbolId))
            throw new Error(`Select an exact symbol in family ${familyId}; family selection cannot choose a default symbol`);
        this._selectedFamilyId = family.id;
        this._activeConflictIndex = -1;
        this._selectionRevision++;
    }

    selectSymbol(symbolId: string): void {
        this.assertSelectionUnlocked();
        const family = this.familyForSymbol(symbolId);
        if (!family)
            throw new Error(`Unknown authored-content symbol: ${symbolId}`);
        this._selectedFamilyId = family.id;
        this._selectedSymbolId = symbolId;
        this._activeConflictIndex = -1;
        this._selectionRevision++;
    }

    selectLocale(locale: string): void {
        this.assertSelectionUnlocked();
        if (!this._snapshot.locales.includes(locale))
            throw new Error(`Unknown authored-content locale: ${locale}`);
        this._selectedLocale = locale;
        this._activeConflictIndex = -1;
        this._selectionRevision++;
    }

    selectPreviewLayer(layer: AuthoredPreviewLayer): void {
        this.assertSelectionUnlocked();
        if (!PREVIEW_LAYERS.includes(layer))
            throw new Error(`Unknown authored-content preview layer: ${layer}`);
        this._previewLayer = layer;
        this._selectionRevision++;
    }

    visibleObligations(): ReadonlyArray<AuthoredObligation> {
        const selected = this._selectedSymbolId;
        return this._snapshot.obligations.filter(item => !item.targetSymbolId || item.targetSymbolId === selected);
    }

    visibleConflicts(): ReadonlyArray<AuthoredConflict> {
        const selected = this._selectedSymbolId;
        return this._snapshot.conflicts.filter(item => item.targetSymbolId === selected);
    }

    navigateConflict(direction: 1 | -1): AuthoredConflict | undefined {
        const conflicts = this._snapshot.conflicts;
        if (!conflicts.length)
            return undefined;
        this._activeConflictIndex = (this._activeConflictIndex + direction + conflicts.length) % conflicts.length;
        const conflict = conflicts[this._activeConflictIndex];
        this.applyConflictSelection(conflict);
        this._activeConflictIndex = conflicts.indexOf(conflict);
        return conflict;
    }

    selectConflict(conflictId: string): AuthoredConflict {
        const conflict = this._snapshot.conflicts.find(value => value.id === conflictId);
        if (!conflict)
            throw new Error(`Unknown authored-content conflict: ${conflictId}`);
        this.applyConflictSelection(conflict);
        this._activeConflictIndex = this._snapshot.conflicts.indexOf(conflict);
        return conflict;
    }

    beginAction(action: AuthoredCockpitAction, message: string): void {
        if (this.busy)
            throw new Error(`Cannot start ${action}; ${this._actionStatus.action} is still running`);
        this._actionStatus = { action, state: "running", progress: 0, message };
    }

    reportProgress(progress: number, message?: string): void {
        if (!this.busy)
            return;
        this._actionStatus = {
            ...this._actionStatus,
            progress: Math.max(0, Math.min(1, progress)),
            message: message || this._actionStatus.message
        };
    }

    finishAction(message: string): void {
        this._actionStatus = {
            action: this._actionStatus.action,
            state: "success",
            progress: 1,
            message
        };
    }

    failAction(message: string): void {
        this._actionStatus = {
            action: this._actionStatus.action,
            state: "error",
            progress: 0,
            message
        };
    }

    resetStatus(message = "Ready"): void {
        this._actionStatus = { state: "idle", progress: 0, message };
    }

    captureAction(action: AuthoredCockpitAction): AuthoredActionCapture {
        const selection = this.captureSelection();
        const symbol = this.selectedSymbol;
        if (!symbol)
            throw new Error(`Cannot ${action}; the exact authored-content symbol became stale`);
        return {
            selectionRevision: this._selectionRevision,
            symbolLabel: symbol.label,
            request: {
                action,
                ...selection
            }
        };
    }

    captureSelection(): AuthoredCockpitSelection {
        if (!this._selectedFamilyId || !this._selectedSymbolId)
            throw new Error("No exact authored-content family and symbol are selected");
        const family = this.findFamily(this._selectedFamilyId);
        if (!family || !family.symbols.some(symbol => symbol.id === this._selectedSymbolId))
            throw new Error("The selected authored-content family or symbol became stale");
        if (!this._snapshot.locales.includes(this._selectedLocale))
            throw new Error("The selected authored-content locale became stale");
        return {
            familyId: this._selectedFamilyId,
            symbolId: this._selectedSymbolId,
            locale: this._selectedLocale,
            previewLayer: this._previewLayer
        };
    }

    isCaptureCurrent(capture: AuthoredActionCapture): boolean {
        return capture.selectionRevision === this._selectionRevision
            && capture.request.familyId === this._selectedFamilyId
            && capture.request.symbolId === this._selectedSymbolId
            && capture.request.locale === this._selectedLocale
            && capture.request.previewLayer === this._previewLayer;
    }

    static commandForHotkey(combo: string): AuthoredCockpitCommand | undefined {
        switch (combo.replace(/\s+/g, "").toLowerCase()) {
            case "ctrl+o": return { kind: "open-xml" };
            case "ctrl+r": return { kind: "action", action: "reimport" };
            case "ctrl+shift+v": return { kind: "action", action: "validate" };
            case "ctrl+shift+r": return { kind: "action", action: "render" };
            case "ctrl+shift+d": return { kind: "action", action: "detach" };
            case "alt+1": return { kind: "preview-layer", layer: "source" };
            case "alt+2": return { kind: "preview-layer", layer: "base" };
            case "alt+3": return { kind: "preview-layer", layer: "final" };
            case "f8": return { kind: "conflict", direction: 1 };
            case "shift+f8": return { kind: "conflict", direction: -1 };
            default: return undefined;
        }
    }

    private findFamily(familyId: string): AuthoredFamilySummary | undefined {
        return this._snapshot.families.find(family => family.id === familyId);
    }

    private findSymbol(symbolId: string): AuthoredSymbolSummary | undefined {
        for (const family of this._snapshot.families) {
            const symbol = family.symbols.find(value => value.id === symbolId);
            if (symbol)
                return symbol;
        }
        return undefined;
    }

    private familyForSymbol(symbolId: string): AuthoredFamilySummary | undefined {
        return this._snapshot.families.find(family => family.symbols.some(symbol => symbol.id === symbolId));
    }

    private validateSnapshot(snapshot: AuthoredCockpitSnapshot): void {
        const familyIds = new Set<string>();
        const symbolIds = new Set<string>();
        const issueIds = new Set<string>();
        for (const family of snapshot.families) {
            if (!family.id || familyIds.has(family.id))
                throw new Error(`Duplicate or empty authored-content family id: ${family.id}`);
            familyIds.add(family.id);
            for (const symbol of family.symbols) {
                if (!symbol.id || symbolIds.has(symbol.id))
                    throw new Error(`Duplicate or empty authored-content symbol id: ${symbol.id}`);
                symbolIds.add(symbol.id);
            }
        }
        if (!snapshot.locales.length)
            throw new Error("Authored-content snapshot must provide at least one locale");
        if (snapshot.locales.some(locale => !locale) || new Set(snapshot.locales).size !== snapshot.locales.length)
            throw new Error("Duplicate authored-content locale");
        for (const issue of [...snapshot.obligations, ...snapshot.conflicts]) {
            if (!issue.id || issueIds.has(issue.id))
                throw new Error(`Duplicate or empty authored-content issue id: ${issue.id}`);
            issueIds.add(issue.id);
            if (issue.targetSymbolId && !symbolIds.has(issue.targetSymbolId))
                throw new Error(`Issue ${issue.id} targets unknown symbol ${issue.targetSymbolId}`);
        }
        for (const obligation of snapshot.obligations) {
            if (obligation.kind === "flash-bridge"
                && (!obligation.flashShape?.sourceShape || !obligation.flashShape.nativeContract))
                throw new Error(`Flash-shaped bridge obligation ${obligation.id} is missing its explicit native contract`);
        }
        for (const conflict of snapshot.conflicts) {
            if (conflict.locale && !snapshot.locales.includes(conflict.locale))
                throw new Error(`Conflict ${conflict.id} targets unknown locale ${conflict.locale}`);
        }
        if (!snapshot.selectedLocale || !snapshot.locales.includes(snapshot.selectedLocale))
            throw new Error(`Unknown or missing selected authored-content locale: ${snapshot.selectedLocale}`);
        if (!snapshot.previewLayer || !PREVIEW_LAYERS.includes(snapshot.previewLayer))
            throw new Error(`Unknown or missing authored-content preview layer: ${snapshot.previewLayer}`);
        if (!snapshot.families.length) {
            if (snapshot.selectedFamilyId || snapshot.selectedSymbolId)
                throw new Error("Empty authored-content snapshot contains a stale family or symbol selection");
            return;
        }
        if (!snapshot.selectedFamilyId || !familyIds.has(snapshot.selectedFamilyId))
            throw new Error(`Unknown or missing selected authored-content family: ${snapshot.selectedFamilyId}`);
        if (!snapshot.selectedSymbolId || !symbolIds.has(snapshot.selectedSymbolId))
            throw new Error(`Unknown or missing selected authored-content symbol: ${snapshot.selectedSymbolId}`);
        const selectedFamily = snapshot.families.find(family => family.id === snapshot.selectedFamilyId)!;
        if (!selectedFamily.symbols.some(symbol => symbol.id === snapshot.selectedSymbolId))
            throw new Error(`Selected symbol ${snapshot.selectedSymbolId} is stale for family ${snapshot.selectedFamilyId}`);
    }

    private assertSelectionUnlocked(): void {
        if (this.busy)
            throw new Error(`Authored-content selection is locked while ${this._actionStatus.action} is running`);
    }

    private applyConflictSelection(conflict: AuthoredConflict): void {
        this.selectSymbol(conflict.targetSymbolId);
        if (conflict.locale)
            this.selectLocale(conflict.locale);
    }
}
