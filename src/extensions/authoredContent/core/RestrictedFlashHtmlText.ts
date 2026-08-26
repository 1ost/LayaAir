export interface RestrictedFlashHtmlTextLayout {
    readonly markup: string;
    readonly plainText: string;
    readonly align: "left" | "center" | "right" | "justify";
    readonly font: string;
    readonly size: number;
    readonly color: number;
    readonly letterSpacing: number;
    readonly kerning: boolean;
    readonly bold: boolean;
}

const FORMATTED_PARAGRAPH = /^<p ([^<>]+)><font ([^<>]+)>([\s\S]*)<\/font><\/p>$/;
const EMPTY_PARAGRAPH = /^<p ([^<>]+)><\/p>$/;
const ATTRIBUTE = /([A-Za-z][A-Za-z0-9]*)="([^"]*)"/gy;
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: "\u00a0", quot: "\"",
});

/**
 * Validates the frozen authored Flash HTML slice. This is deliberately not a
 * browser HTML parser: only consecutive p/font runs plus balanced b/br/sbr and
 * color- or face-only nested font content are accepted. Every formatting
 * attribute is authenticated before the markup reaches TextField.htmlText.
 * Empty paragraphs retain Flash's authored line breaks but cannot introduce
 * formatting of their own.
 */
export function parseRestrictedFlashHtmlText(markup: string): RestrictedFlashHtmlTextLayout {
    if (typeof markup !== "string")
        throw new TypeError("AUTHORED_CONTENT_HTML_TEXT_REQUIRED: markup must be a string.");
    const paragraphRuns = markup.split(/(?=<p )/);
    const paragraphs = paragraphRuns.map(run => {
        const formatted = FORMATTED_PARAGRAPH.exec(run);
        if (formatted) return {
            align: attributes(formatted[1], new Set(["align"]), "paragraph").align,
            font: attributes(formatted[2], new Set(["color", "face", "kerning", "letterSpacing", "size"]), "font"),
            content: formatted[3],
        };
        const empty = EMPTY_PARAGRAPH.exec(run);
        if (empty) return {
            align: attributes(empty[1], new Set(["align"]), "paragraph").align,
            font: undefined,
            content: "",
        };
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_SUBSET_UNSUPPORTED: expected exact consecutive p/font runs.");
    });
    const formatted = paragraphs.filter(paragraph => paragraph.font !== undefined);
    if (formatted.length === 0)
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_FORMAT_MISSING: at least one paragraph must carry exact font authority.");
    const font = formatted[0].font!;
    const align = paragraphs[0].align;
    if (align !== "left" && align !== "center" && align !== "right" && align !== "justify")
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_ALIGN_UNSUPPORTED: paragraph alignment is unsupported.");
    if (paragraphs.some(paragraph => paragraph.align !== align))
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_FORMAT_DRIFT: paragraph runs must share one alignment.");
    const fontFields = ["color", "face", "kerning", "letterSpacing", "size"] as const;
    if (formatted.some(paragraph => fontFields.some(field => paragraph.font![field] !== font[field])))
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_FORMAT_DRIFT: paragraph runs must share one exact font format.");
    validFontFace(font.face);
    const size = finiteNumber(font.size, "size");
    if (size <= 0) throw new Error("AUTHORED_CONTENT_HTML_TEXT_SIZE_INVALID: font size must be positive.");
    if (!/^#[0-9a-fA-F]{6}$/.test(font.color))
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_COLOR_INVALID: color must be six-digit RGB.");
    const letterSpacing = finiteNumber(font.letterSpacing, "letterSpacing");
    if (font.kerning !== "0" && font.kerning !== "1")
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_KERNING_INVALID: kerning must be 0 or 1.");
    const content = decodeContent(paragraphs.map(paragraph => paragraph.content).join("<br/>"));
    return Object.freeze({
        markup,
        plainText: content.plainText,
        align,
        font: font.face,
        size,
        color: Number.parseInt(font.color.slice(1), 16),
        letterSpacing,
        kerning: font.kerning === "1",
        bold: content.bold,
    });
}

function attributes(source: string, allowed: ReadonlySet<string>, label: string): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    let cursor = 0;
    while (cursor < source.length) {
        ATTRIBUTE.lastIndex = cursor;
        const match = ATTRIBUTE.exec(source);
        if (!match || match.index !== cursor || (!allowed.has(match[1])) || result[match[1]] !== undefined)
            throw new Error(`AUTHORED_CONTENT_HTML_TEXT_ATTRIBUTE_UNSUPPORTED: malformed or duplicate ${label} attribute.`);
        result[match[1]] = match[2];
        cursor = ATTRIBUTE.lastIndex;
        if (cursor < source.length) {
            if (source[cursor] !== " ")
                throw new Error(`AUTHORED_CONTENT_HTML_TEXT_ATTRIBUTE_UNSUPPORTED: ${label} attributes require one separator.`);
            cursor++;
        }
    }
    if (Object.keys(result).length !== allowed.size)
        throw new Error(`AUTHORED_CONTENT_HTML_TEXT_ATTRIBUTE_MISSING: ${label} attributes are incomplete.`);
    return result;
}

function decodeContent(source: string): { readonly plainText: string; readonly bold: boolean } {
    let cursor = 0;
    let boldDepth = 0;
    const tagStack: ("b" | "font")[] = [];
    let sawBoldText = false;
    let sawPlainText = false;
    let plainText = "";
    while (cursor < source.length) {
        if (source.startsWith("<b>", cursor)) { boldDepth++; tagStack.push("b"); cursor += 3; continue; }
        if (source.startsWith("</b>", cursor)) {
            if (boldDepth === 0 || tagStack.pop() !== "b")
                throw new Error("AUTHORED_CONTENT_HTML_TEXT_NESTING_INVALID: unmatched or crossed </b>.");
            boldDepth--; cursor += 4; continue;
        }
        const nestedFontMatch = /^<font ([^<>]+)>/.exec(source.slice(cursor));
        if (nestedFontMatch) {
            const nestedFontSource = nestedFontMatch[1];
            if (nestedFontSource.startsWith('color="')) {
                const nestedFont = attributes(nestedFontSource, new Set(["color"]), "nested font");
                if (!/^#[0-9a-fA-F]{6}$/.test(nestedFont.color))
                    throw new Error("AUTHORED_CONTENT_HTML_TEXT_COLOR_INVALID: nested font color must be six-digit RGB.");
            } else if (nestedFontSource.startsWith('face="')) {
                const nestedFont = attributes(nestedFontSource, new Set(["face"]), "nested font");
                validFontFace(nestedFont.face);
            } else {
                throw new Error("AUTHORED_CONTENT_HTML_TEXT_ATTRIBUTE_UNSUPPORTED: nested font admits one color or face attribute.");
            }
            tagStack.push("font");
            cursor += nestedFontMatch[0].length;
            continue;
        }
        if (source.startsWith("</font>", cursor)) {
            if (tagStack.pop() !== "font")
                throw new Error("AUTHORED_CONTENT_HTML_TEXT_NESTING_INVALID: unmatched or crossed </font>.");
            cursor += 7;
            continue;
        }
        const breakMatch = /^<(?:br|sbr)\s*\/?>/.exec(source.slice(cursor));
        if (breakMatch) { plainText += "\r"; cursor += breakMatch[0].length; continue; }
        if (source[cursor] === "<")
            throw new Error("AUTHORED_CONTENT_HTML_TEXT_TAG_UNSUPPORTED: only b, br, sbr, and color- or face-only font runs are allowed in font content.");
        let character: string;
        if (source[cursor] === "&") {
            const end = source.indexOf(";", cursor + 1);
            if (end < 0) throw new Error("AUTHORED_CONTENT_HTML_TEXT_ENTITY_UNSUPPORTED: unterminated entity.");
            character = decodeEntity(source.slice(cursor + 1, end));
            cursor = end + 1;
        } else {
            const codePoint = source.codePointAt(cursor)!;
            character = String.fromCodePoint(codePoint);
            cursor += character.length;
        }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(character))
            throw new Error("AUTHORED_CONTENT_HTML_TEXT_CONTROL_UNSUPPORTED: control characters are not admitted.");
        plainText += character;
        if (!/^\s$/u.test(character) && character !== "\u00a0") {
            if (boldDepth > 0) sawBoldText = true;
            else sawPlainText = true;
        }
    }
    if (tagStack.length !== 0 || boldDepth !== 0)
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_NESTING_INVALID: unclosed nested formatting tag.");
    return { plainText, bold: sawBoldText && !sawPlainText };
}

function validFontFace(value: string): void {
    if (!value || /[<>\u0000-\u001f\u007f]/.test(value))
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_FACE_INVALID: font face must be stable text.");
}

function decodeEntity(value: string): string {
    const named = NAMED_ENTITIES[value];
    if (named !== undefined) return named;
    const match = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(value);
    if (!match)
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_ENTITY_UNSUPPORTED: entity is outside the frozen vocabulary.");
    const codePoint = Number.parseInt(match[1] ?? match[2], match[1] ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff
        || codePoint >= 0xd800 && codePoint <= 0xdfff)
        throw new Error("AUTHORED_CONTENT_HTML_TEXT_ENTITY_INVALID: numeric entity is not a Unicode scalar.");
    return String.fromCodePoint(codePoint);
}

function finiteNumber(value: string, label: string): number {
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))
        throw new Error(`AUTHORED_CONTENT_HTML_TEXT_NUMBER_INVALID: ${label} must be finite decimal text.`);
    const number = Number(value);
    if (!Number.isFinite(number))
        throw new Error(`AUTHORED_CONTENT_HTML_TEXT_NUMBER_INVALID: ${label} must be finite.`);
    return number;
}
