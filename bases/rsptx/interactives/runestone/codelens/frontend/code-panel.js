// Read-only CodeMirror 6 display of the traced program: syntax highlighting,
// current/previous line markers, and a breakpoint gutter.
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, Decoration, GutterMarker, WidgetType, gutter, lineNumbers } from "@codemirror/view";
import { LRLanguage, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { parser as pythonParser } from "@lezer/python";
import { parser as javaParser } from "@lezer/java";
import { parser as cppParser } from "@lezer/cpp";
import { t } from "../../common/js/rsi18n.js";

function languageFor(lang = "") {
    // The grammars carry their own highlighting tags; nothing else is needed
    // from the larger @codemirror/lang-* packages for a read-only display.
    const parser = lang.startsWith("py") ? pythonParser
        : lang === "java" ? javaParser
            : lang === "cpp" || lang === "c" ? cppParser : null;
    return parser ? LRLanguage.define({ parser }) : [];
}

const setMarkers = StateEffect.define();
const markersField = StateField.define({
    create: () => ({ current: null, previous: null, breakpoints: new Set() }),
    update(value, transaction) {
        for (const effect of transaction.effects) if (effect.is(setMarkers)) value = effect.value;
        return value;
    },
});

/** Screen-reader-only line prefix, standing in for the aria-hidden gutters. */
class LineLabel extends WidgetType {
    constructor(text) {
        super();
        this.text = text;
    }
    eq(other) {
        return other.text === this.text;
    }
    toDOM() {
        const node = document.createElement("span");
        node.className = "rs-codelens-prototype__sr-only";
        node.textContent = this.text;
        return node;
    }
    ignoreEvent() {
        return true;
    }
}

class LineMarker extends GutterMarker {
    constructor(kinds) {
        super();
        this.kinds = kinds;
    }
    eq(other) {
        return other.kinds === this.kinds;
    }
    toDOM() {
        const node = document.createElement("span");
        node.className = "rs-codelens-code__marker";
        node.dataset.kinds = this.kinds;
        return node;
    }
}

function lineDecorations(state) {
    const { current, previous, breakpoints } = state.field(markersField);
    const ranges = [];
    for (let number = 1; number <= state.doc.lines; number++) {
        const line = state.doc.line(number);
        let label = `${t("cl_line", number)}: `;
        if (number === current) label += t("cl_current_line");
        if (breakpoints.has(number)) label += t("cl_breakpoint_label");
        ranges.push(Decoration.widget({ widget: new LineLabel(label), side: -1 }).range(line.from));
        const classes = [
            number === current && "rs-codelens-code__line--current",
            number === previous && number !== current && "rs-codelens-code__line--previous",
            breakpoints.has(number) && "rs-codelens-code__line--breakpoint",
        ].filter(Boolean);
        if (classes.length) ranges.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
    }
    return Decoration.set(ranges, true);
}

/**
 * Mount the code display. `breakableLines` limits where breakpoints may be set;
 * `onToggleBreakpoint(line)` is called for pointer clicks in the gutters.
 */
export function createCodePanel({ code, lang, breakableLines, onToggleBreakpoint }) {
    const element = document.createElement("div");
    element.className = "rs-codelens-prototype__code";
    const toggle = (view, block) => {
        const number = view.state.doc.lineAt(block.from).number;
        if (breakableLines.has(number)) onToggleBreakpoint(number);
        return true;
    };
    const handlers = { mousedown: toggle };
    const markersChanged = (update) =>
        update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setMarkers)));
    const view = new EditorView({
        parent: element,
        state: EditorState.create({
            doc: code.replace(/\r\n?/g, "\n").replace(/\n$/, ""),
            extensions: [
                markersField,
                EditorView.editable.of(false),
                // Static text inside a group reads in browse mode, unlike a textbox.
                EditorView.contentAttributes.of({ role: "group", "aria-label": t("cl_code") }),
                EditorView.decorations.compute([markersField], lineDecorations),
                languageFor(lang),
                syntaxHighlighting(classHighlighter),
                gutter({
                    class: "rs-codelens-code__breakpoints",
                    lineMarker(view, block) {
                        const number = view.state.doc.lineAt(block.from).number;
                        const { current, previous, breakpoints } = view.state.field(markersField);
                        const kinds = [
                            breakableLines.has(number) && "breakable",
                            breakpoints.has(number) && "breakpoint",
                            number === current && "current",
                            number === previous && number !== current && "previous",
                        ].filter(Boolean).join(" ");
                        return kinds ? new LineMarker(kinds) : null;
                    },
                    lineMarkerChange: markersChanged,
                    initialSpacer: () => new LineMarker("spacer"),
                    domEventHandlers: handlers,
                }),
                lineNumbers({ domEventHandlers: handlers }),
            ],
        }),
    });
    let markers = view.state.field(markersField);

    return {
        element,
        setMarkers({ current = markers.current, previous = markers.previous, breakpoints = markers.breakpoints }) {
            markers = { current, previous, breakpoints: new Set(breakpoints) };
            view.dispatch({ effects: setMarkers.of(markers) });
        },
        destroy() {
            view.destroy();
        },
    };
}
