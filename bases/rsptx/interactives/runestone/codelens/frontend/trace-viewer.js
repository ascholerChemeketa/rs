// A small, read-only viewer for experimenting with accessible trace output.
// The trace format is produced elsewhere; this module never executes code.
import { t } from "../../common/js/rsi18n.js";
import "./frontend-i18n.en.js";
import {
    normalizeMemory, memoryChanges, findInlineFunctions, hasCppStrings, simplifyCppStrings,
} from "./memory-model.js";
import { createMemoryView } from "./memory-view.js";
import { createCodePanel } from "./code-panel.js";

const mountedViewers = new WeakMap();
let nextViewerId = 0;
const svgNamespace = "http://www.w3.org/2000/svg";
const iconShapes = {
    first: ["M3 3h2v10H3z", "M13 3 6 8l7 5z"],
    prevbp: ["circle", "M15 3 9 8l6 5z"],
    back: ["M11 3 4 8l7 5z"],
    fwd: ["M5 3l7 5-7 5z"],
    nextbp: ["M1 3l6 5-6 5z", "circle"],
    last: ["M3 3l7 5-7 5z", "M11 3h2v10h-2z"],
};

function stepIcon(action) {
    const icon = document.createElementNS(svgNamespace, "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    for (const shape of iconShapes[action]) {
        const node = document.createElementNS(svgNamespace, shape === "circle" ? "circle" : "path");
        if (shape === "circle") {
            // The breakpoint dot sits on the side the button moves toward.
            node.setAttribute("cx", action === "prevbp" ? "4.5" : "11.5");
            node.setAttribute("cy", "8");
            node.setAttribute("r", "3");
            node.setAttribute("class", "rs-codelens-prototype__icon-breakpoint");
        } else {
            node.setAttribute("d", shape);
        }
        icon.append(node);
    }
    return icon;
}

// Breakpoints persist per visualizer in this browser only. Storage can be
// unavailable (private windows, blocked site data); the viewer works without it.
function loadBreakpoints(key, breakableLines) {
    if (!key) return new Set();
    try {
        const stored = JSON.parse(window.localStorage.getItem(`codelens-breakpoints:${key}`) ?? "[]");
        return new Set(Array.isArray(stored) ? stored.filter((line) => breakableLines.has(line)) : []);
    } catch {
        return new Set();
    }
}

function saveBreakpoints(key, breakpoints) {
    if (!key) return;
    try {
        const storageKey = `codelens-breakpoints:${key}`;
        if (breakpoints.size === 0) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, JSON.stringify([...breakpoints]));
    } catch {
        // Breakpoints still work for this page view.
    }
}

function element(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
}

function traceLine(entry) {
    return Number.isInteger(entry.line) && entry.line > 0
        ? t("cl_line", entry.line)
        : t("cl_no_line");
}

/** Mount a read-only view of an existing Python Tutor trace. */
export function mountTraceViewer(container, data, options = {}) {
    if (!(container instanceof Element)) {
        throw new TypeError("CodeLens container must be an element");
    }
    if (typeof data?.code !== "string" || !Array.isArray(data.trace)) {
        throw new TypeError("CodeLens trace must contain code and trace fields");
    }
    if (data.trace.length === 0) {
        throw new TypeError("CodeLens trace has no steps");
    }
    mountedViewers.get(container)?.destroy();
    let destroyed = false;

    const requestedStep = options.startingInstruction ?? data.startingInstruction ?? 0;
    let step = Number.isFinite(requestedStep)
        ? Math.max(0, Math.min(data.trace.length - 1, Math.trunc(requestedStep)))
        : 0;

    const root = element("section", "rs-codelens-prototype");
    root.setAttribute("aria-label", t("cl_viewer"));

    const viewerHeading = element(
        "h2",
        "rs-codelens-prototype__sr-only",
        t("cl_trace"),
    );
    root.dataset.layout = "auto";
    const layoutControls = element("div", "rs-codelens-prototype__layout-control");
    const layoutLabel = element("label", null, t("cl_viewer_layout"));
    const layoutSelect = element("select");
    layoutSelect.id = `rs-codelens-layout-${++nextViewerId}`;
    layoutLabel.htmlFor = layoutSelect.id;
    for (const mode of ["auto", "side-by-side", "stacked"]) {
        const option = element("option", null, t(`cl_layout_${mode}`));
        option.value = mode;
        layoutSelect.append(option);
    }
    layoutSelect.addEventListener("change", () => {
        root.dataset.layout = layoutSelect.value;
    });
    layoutControls.append(layoutLabel, layoutSelect);
    const workspace = element("div", "rs-codelens-prototype__workspace");
    const codePanel = element("section", "rs-codelens-prototype__code-panel");
    codePanel.setAttribute("aria-label", t("cl_code"));
    const codeHeading = element("h3", null, t("cl_code"));
    const lineOf = (index) => data.trace[index]?.line;
    const breakableLines = new Set(data.trace.map((entry) => entry.line).filter((line) => Number.isInteger(line) && line > 0));
    const breakpoints = loadBreakpoints(options.breakpointKey, breakableLines);
    const codeView = createCodePanel({
        code: data.code,
        lang: options.lang,
        breakableLines,
        onToggleBreakpoint: toggleBreakpoint,
    });
    const codeHelp = element("p", "rs-codelens-prototype__code-help", t("cl_breakpoint_help"));

    const controls = element("div", "rs-codelens-prototype__controls");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", t("cl_step_controls"));
    const buttons = {};
    for (const [action, key] of [
        ["first", "cl_start"],
        ["prevbp", "cl_previous_breakpoint"],
        ["back", "cl_previous"],
        ["fwd", "cl_next"],
        ["nextbp", "cl_next_breakpoint"],
        ["last", "cl_end"],
    ]) {
        const button = element("button", "rs-codelens-prototype__step-button");
        button.type = "button";
        button.dataset.codelensAction = action;
        button.title = t(key);
        button.append(stepIcon(action), element("span", "rs-codelens-prototype__button-label", t(key)));
        buttons[action] = button;
        controls.append(button);
    }
    const status = element("p", "rs-codelens-prototype__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");

    const inlineFunctions = findInlineFunctions(data.trace, options.lang);
    // C++ strings read as text by default; a switch shows how they are stored.
    const hasStrings = options.lang === "cpp" && hasCppStrings(data.trace);
    let simpleStrings = hasStrings;
    const heapUsed = () => data.trace.some((entry) => {
        const buffers = simpleStrings ? simplifyCppStrings(entry).buffers : new Set();
        return Object.keys(entry.heap ?? {}).some((id) => !inlineFunctions.has(id) && !buffers.has(id));
    });
    const memoryView = createMemoryView({
        hasHeap: heapUsed(),
        stringSwitch: hasStrings ? {
            checked: simpleStrings,
            onChange(checked) {
                simpleStrings = checked;
                memoryView.setHasHeap(heapUsed());
                previousMemory = currentMemory();
                memoryView.update(previousMemory, []);
            },
        } : null,
    });
    let previousMemory = null;
    const outputHeading = element("h3", null, t("cl_output"));
    const output = element("pre", "rs-codelens-prototype__output");
    output.setAttribute("aria-label", t("cl_output"));
    // Programs that never print get no output area.
    const hasOutput = data.trace.some((entry) => typeof entry.stdout === "string" && entry.stdout.length > 0);

    codePanel.append(codeHeading, codeView.element, codeHelp, controls, status);
    if (hasOutput) codePanel.append(outputHeading, output);
    workspace.append(codePanel, memoryView.element);
    root.append(viewerHeading, workspace, layoutControls);
    container.replaceChildren(root);

    // A breakpoint stops where execution arrives on its line, so a line that
    // spans several consecutive steps (a call and its return) stops once.
    function stopsAt(index) {
        return breakpoints.has(lineOf(index)) && (index === 0 || lineOf(index - 1) !== lineOf(index));
    }

    function breakpointStep(direction) {
        for (let index = step + direction; index >= 0 && index < data.trace.length; index += direction) {
            if (stopsAt(index)) return index;
        }
        return null;
    }

    function updateButtons() {
        const last = data.trace.length - 1;
        for (const [action, disabled] of [
            ["first", step === 0],
            ["back", step === 0],
            ["fwd", step === last],
            ["last", step === last],
            ["prevbp", breakpointStep(-1) === null],
            ["nextbp", breakpointStep(1) === null],
        ]) {
            buttons[action].setAttribute("aria-disabled", String(disabled));
        }
    }

    function toggleBreakpoint(line) {
        if (destroyed || !breakableLines.has(line)) return false;
        const added = !breakpoints.has(line);
        if (added) breakpoints.add(line);
        else breakpoints.delete(line);
        saveBreakpoints(options.breakpointKey, breakpoints);
        codeView.setMarkers({ breakpoints });
        updateButtons();
        status.textContent = t(added ? "cl_breakpoint_set" : "cl_breakpoint_removed", line);
        return true;
    }

    function currentMemory() {
        return normalizeMemory(data.trace[step], options.lang, data.code, inlineFunctions, { simpleStrings });
    }

    function render(previousStep = null, atBreakpoint = false) {
        const entry = data.trace[step];
        codeView.setMarkers({ current: entry.line, previous: step > 0 ? lineOf(step - 1) : null, breakpoints });
        updateButtons();

        const memory = currentMemory();
        const changes = memoryChanges(previousMemory, memory);
        memoryView.update(memory, changes);
        previousMemory = memory;

        const stdout = typeof entry.stdout === "string" ? entry.stdout : "";
        output.textContent = stdout;
        let announcement = atBreakpoint ? `${t("cl_at_breakpoint")} ` : "";
        announcement += t("cl_step", step + 1, data.trace.length, traceLine(entry));
        if (changes.length > 0) {
            announcement += ` ${changes.slice(0, 3).map((change) => change.text).join(" ")}`;
        }
        if (changes.length > 3) {
            announcement += ` ${t("cl_more_changes", changes.length - 3)}`;
        }
        if (previousStep !== null) {
            const oldStdout = data.trace[previousStep].stdout ?? "";
            if (stdout !== oldStdout) {
                if (stdout.startsWith(oldStdout)) {
                    const added = stdout.slice(oldStdout.length).trim() || t("cl_whitespace");
                    announcement += ` ${t("cl_new_output", added)}${/[.!?]$/.test(added) ? "" : "."}`;
                } else {
                    announcement += ` ${t("cl_output_changed")}`;
                }
            }
        }
        status.textContent = announcement;
    }

    function goToStep(destination, atBreakpoint = false) {
        if (destroyed || destination === null || destination === step ||
            destination < 0 || destination >= data.trace.length) return false;
        const previousStep = step;
        step = destination;
        render(previousStep, atBreakpoint);
        return true;
    }

    const stepForward = () => goToStep(step + 1);
    const stepBackward = () => goToStep(step - 1);
    const actions = {
        first: () => goToStep(0),
        prevbp: () => goToStep(breakpointStep(-1), true),
        back: stepBackward,
        fwd: stepForward,
        nextbp: () => goToStep(breakpointStep(1), true),
        last: () => goToStep(data.trace.length - 1),
    };

    for (const [action, button] of Object.entries(buttons)) {
        button.addEventListener("click", (event) => {
            if (!actions[action]()) {
                // Unavailable moves are not logged as navigation.
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        });
    }
    render();
    const controller = {
        element: root,
        get currentStep() {
            return step;
        },
        get breakpoints() {
            return [...breakpoints].sort((a, b) => a - b);
        },
        stepForward,
        stepBackward,
        goToStart: actions.first,
        goToEnd: actions.last,
        nextBreakpoint: actions.nextbp,
        previousBreakpoint: actions.prevbp,
        toggleBreakpoint,
        destroy() {
            destroyed = true;
            codeView.destroy();
            memoryView.destroy();
            root.remove();
            if (mountedViewers.get(container) === controller) {
                mountedViewers.delete(container);
            }
        },
    };
    mountedViewers.set(container, controller);
    return controller;
}
