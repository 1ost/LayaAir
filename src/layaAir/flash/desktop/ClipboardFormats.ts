/** Source-used AIR clipboard format constants. */
export class ClipboardFormats {
    static readonly BITMAP_FORMAT = "air:bitmap";
    static readonly FILE_LIST_FORMAT = "air:file list";
    static readonly HTML_FORMAT = "air:html";
    static readonly RICH_TEXT_FORMAT = "air:rtf";
    static readonly TEXT_FORMAT = "air:text";
    static readonly URL_FORMAT = "air:url";

    private constructor() { throw new TypeError("ClipboardFormats is a static class"); }
}

Object.freeze(ClipboardFormats);
