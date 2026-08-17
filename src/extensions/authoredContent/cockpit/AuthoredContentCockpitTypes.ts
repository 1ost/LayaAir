export type AuthoredPreviewLayer = "source" | "base" | "final";

export type AuthoredCockpitAction = "reimport" | "detach" | "validate" | "render";

export type AuthoredIssueSeverity = "error" | "warning" | "info";

export interface AuthoredSymbolSummary {
    id: string;
    label: string;
    kind: string;
    status?: "ready" | "warning" | "error" | "detached";
}

export interface AuthoredFamilySummary {
    id: string;
    label: string;
    symbols: AuthoredSymbolSummary[];
}

export interface AuthoredObligation {
    id: string;
    kind: "compatibility" | "binding" | "flash-bridge";
    severity: AuthoredIssueSeverity;
    label: string;
    details: string;
    targetSymbolId?: string;
    flashShape?: {
        sourceShape: string;
        nativeContract: string;
    };
}

export interface AuthoredConflict {
    id: string;
    severity: "error" | "warning";
    label: string;
    details: string;
    targetSymbolId: string;
    locale?: string;
}

export interface AuthoredCockpitSnapshot {
    families: AuthoredFamilySummary[];
    locales: string[];
    selectedFamilyId?: string;
    selectedSymbolId?: string;
    selectedLocale?: string;
    previewLayer?: AuthoredPreviewLayer;
    sourcePath?: string;
    obligations: AuthoredObligation[];
    conflicts: AuthoredConflict[];
}

export interface AuthoredCockpitSelection {
    familyId: string;
    symbolId: string;
    locale: string;
    previewLayer: AuthoredPreviewLayer;
}

export interface AuthoredCockpitRequest extends AuthoredCockpitSelection {
    action: AuthoredCockpitAction;
}

export interface AuthoredActionCapture {
    request: AuthoredCockpitRequest;
    selectionRevision: number;
    symbolLabel: string;
}

export interface AuthoredActionResult {
    message?: string;
    snapshot?: AuthoredCockpitSnapshot;
}

export interface AuthoredNativePreviewTarget {
    assetId: string;
}

export interface AuthoredActionStatus {
    action?: AuthoredCockpitAction;
    state: "idle" | "running" | "success" | "error";
    progress: number;
    message: string;
}

export type AuthoredCockpitCommand =
    | { kind: "open-xml" }
    | { kind: "action"; action: AuthoredCockpitAction }
    | { kind: "preview-layer"; layer: AuthoredPreviewLayer }
    | { kind: "conflict"; direction: 1 | -1 };
