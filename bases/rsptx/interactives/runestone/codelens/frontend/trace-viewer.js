// A small, read-only viewer for experimenting with accessible trace output.
// The trace format is produced elsewhere; this module never executes code.
import { t } from "../../common/js/rsi18n.js";
import "./frontend-i18n.en.js";
import { normalizeMemory, memoryChanges } from "./memory-model.js";
import { createMemoryView } from "./memory-view.js";

const mountedViewers = new WeakMap();
let nextViewerId = 0;

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
    const codePre = element("pre", "rs-codelens-prototype__code");
    const code = element("code");
    codePre.append(code);
    const sourceLines = data.code.replace(/\r\n?/g, "\n").split("\n");
    if (sourceLines[sourceLines.length - 1] === "") sourceLines.pop();
    const lineNodes = sourceLines.map((source, index) => {
        const row = element("span", "rs-codelens-prototype__line");
        row.dataset.line = String(index + 1);
        row.append(
            element(
                "span", "rs-codelens-prototype__sr-only",
                `${t("cl_line", index + 1)}: `,
            ),
            element("span", "rs-codelens-prototype__line-number", String(index + 1)),
            element("span", "rs-codelens-prototype__current-label"),
            element("span", "rs-codelens-prototype__source", source || " "),
        );
        row.querySelector(".rs-codelens-prototype__line-number").setAttribute(
            "aria-hidden",
            "true",
        );
        code.append(row);
        return row;
    });

    const controls = element("div", "rs-codelens-prototype__controls");
    const previous = element("button", null, t("cl_previous"));
    previous.type = "button";
    previous.dataset.codelensAction = "back";
    const next = element("button", null, t("cl_next"));
    next.type = "button";
    next.dataset.codelensAction = "fwd";
    controls.append(previous, next);
    const status = element("p", "rs-codelens-prototype__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");

    const hasHeap = data.trace.some((entry) => Object.keys(entry.heap ?? {}).length > 0);
    const memoryView = createMemoryView({ hasHeap });
    let previousMemory = null;
    const outputHeading = element("h3", null, t("cl_output"));
    const output = element("pre", "rs-codelens-prototype__output");
    output.setAttribute("aria-label", t("cl_output"));

    codePanel.append(
        codeHeading,
        codePre,
        controls,
        status,
        outputHeading,
        output,
    );
    workspace.append(codePanel, memoryView.element);
    root.append(viewerHeading, layoutControls, workspace);
    container.replaceChildren(root);

    function render(previousStep = null) {
        const entry = data.trace[step];
        for (const [index, row] of lineNodes.entries()) {
            const current = index + 1 === entry.line;
            row.classList.toggle("rs-codelens-prototype__line--current", current);
            row.querySelector(".rs-codelens-prototype__current-label").textContent =
                current ? t("cl_current_line") : "";
        }
        previous.setAttribute("aria-disabled", String(step === 0));
        next.setAttribute("aria-disabled", String(step === data.trace.length - 1));

        const memory = normalizeMemory(entry, options.lang);
        const changes = memoryChanges(previousMemory, memory);
        memoryView.update(memory, changes);
        previousMemory = memory;

        const stdout = typeof entry.stdout === "string" ? entry.stdout : "";
        output.textContent = stdout;
        let announcement = t("cl_step", step + 1, data.trace.length, traceLine(entry));
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

    function moveStep(direction) {
        const destination = step + direction;
        if (destroyed || destination < 0 || destination >= data.trace.length) return false;
        const previousStep = step;
        step = destination;
        render(previousStep);
        return true;
    }

    const stepForward = () => moveStep(1);
    const stepBackward = () => moveStep(-1);

    for (const [button, action] of [[previous, stepBackward], [next, stepForward]]) {
        button.addEventListener("click", (event) => {
            if (!action()) {
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
        stepForward,
        stepBackward,
        destroy() {
            destroyed = true;
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
