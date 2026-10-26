import { t } from "../../common/js/rsi18n.js";
import { memoryKey, valueText, aggregateRows, cAddress } from "./memory-model.js";
import { createGraphicalHeap } from "./graphical-heap.js";
import { curvedConnectorPath } from "./connector-path.js";

let nextViewId = 0;
const svgNamespace = "http://www.w3.org/2000/svg";

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function svgElement(tag, attributes) {
    const node = document.createElementNS(svgNamespace, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
}

/** Three layouts of one semantic tree. Only the connector overlay is aria-hidden. */
export function createMemoryView({ hasHeap = true } = {}) {
    const prefix = `rs-cl-memory-${++nextViewId}`;
    const root = element("section", "rs-codelens-memory");
    const heading = element("h3", null, t("cl_memory"));
    heading.id = `${prefix}-heading`;
    heading.tabIndex = -1;
    root.setAttribute("aria-labelledby", heading.id);
    const viewControls = element("fieldset", "rs-codelens-memory__view-controls");
    viewControls.append(element("legend", null, t("cl_memory_view")));
    const stage = element("div", "rs-codelens-memory__stage");
    const viewport = element("div", "rs-codelens-memory__viewport");
    viewport.dataset.view = "diagram";
    stage.dataset.view = "diagram";
    stage.dataset.hasHeap = String(hasHeap);
    for (const mode of ["diagram", "graphical", "text"]) {
        const label = element("label");
        const radio = element("input");
        radio.type = "radio";
        radio.name = `${prefix}-view`;
        radio.value = mode;
        radio.checked = mode === "diagram";
        radio.addEventListener("change", () => {
            if (radio.checked) {
                stage.dataset.view = mode;
                viewport.dataset.view = mode;
                viewport.tabIndex = mode === "graphical" ? 0 : -1;
                if (mode === "graphical") {
                    viewport.setAttribute("role", "region");
                    viewport.setAttribute("aria-label", t("cl_graph_viewport"));
                } else {
                    viewport.removeAttribute("role");
                    viewport.removeAttribute("aria-label");
                }
                graphical.setEnabled(mode === "graphical" && hasHeap);
                scheduleDraw();
            }
        });
        label.append(radio, document.createTextNode(` ${t(`cl_${mode}`)}`));
        viewControls.append(label);
    }
    const help = element("p", "rs-codelens-memory__help", t("cl_memory_help"));
    const overlay = svgElement("svg", {
        class: "rs-codelens-memory__connectors",
        "aria-hidden": "true",
        focusable: "false",
    });
    const stack = element("section", "rs-codelens-memory__column rs-codelens-memory__column--stack");
    const heap = element("section", "rs-codelens-memory__column rs-codelens-memory__column--heap");
    heap.hidden = !hasHeap;
    const heapCanvas = element("div", "rs-codelens-memory__heap-canvas");
    const graphical = createGraphicalHeap({ canvas: heapCanvas, prefix, onChange: scheduleDraw });
    const changeDetails = element("details", "rs-codelens-memory__changes");
    const changeSummary = element("summary");
    const changeList = element("ul");
    changeDetails.append(changeSummary, changeList);
    changeDetails.hidden = true;
    stage.append(overlay, stack, heap);
    viewport.append(stage);
    root.append(heading, viewControls, help, graphical.element, viewport, changeDetails);

    let references = [];
    let targets = new Map();
    let pointerTargets = new Map();
    let pendingPointers = [];
    let frameTargets = new Map();
    let pendingDraw = null;
    let destroyed = false;
    let activeReference = null;

    function scheduleDraw() {
        if (pendingDraw !== null || destroyed) return;
        pendingDraw = window.requestAnimationFrame(() => {
            pendingDraw = null;
            if (!destroyed && root.isConnected) drawConnectors();
        });
    }

    function drawConnectors() {
        overlay.replaceChildren();
        if (stage.dataset.view === "text") return;
        const bounds = stage.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return;
        overlay.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
        const defs = svgElement("defs", {});
        const marker = svgElement("marker", {
            id: `${prefix}-arrow`, viewBox: "0 0 10 10", refX: "9", refY: "5",
            markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse",
        });
        marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z" }));
        defs.append(marker);
        overlay.append(defs);
        for (const [index, reference] of references.entries()) {
            const target = reference.target;
            if (!target) continue;
            const sourceCard = reference.link.closest(".rs-codelens-memory__card");
            const targetCard = target.closest(".rs-codelens-memory__card");
            const sourceRect = sourceCard.getBoundingClientRect();
            const cellRect = reference.link.closest("td, th").getBoundingClientRect();
            const targetCell = target.matches("th") ? target.nextElementSibling : null;
            const targetRect = (targetCell ?? targetCard).getBoundingClientRect();
            const targetHeading = (targetCell ?? target).getBoundingClientRect();
            const x1 = cellRect.right - bounds.left;
            const y1 = cellRect.top + cellRect.height / 2 - bounds.top;
            const y2 = targetHeading.top + targetHeading.height / 2 - bounds.top;
            let path;
            const route = stage.dataset.view === "graphical" && graphical.routeFor(reference);
            if (route?.length > 1) {
                const canvasBounds = heapCanvas.getBoundingClientRect();
                path = curvedConnectorPath([{ x: x1, y: y1 }, ...route.map((point) => ({
                    x: point.x + canvasBounds.left - bounds.left,
                    y: point.y + canvasBounds.top - bounds.top,
                }))]);
            } else if (stage.dataset.view === "graphical" && !sourceCard.dataset.heapId &&
                targetRect.left > heapCanvas.getBoundingClientRect().left + targetRect.width) {
                // Reach later heap columns through the top gutter, without making
                // an obscured stack edge appear to originate in an intervening card.
                const exit = x1 + 12 + (index % 4) * 4;
                const top = heapCanvas.getBoundingClientRect().top - bounds.top + 8;
                const end = targetRect.left + targetRect.width / 2 - bounds.left;
                path = curvedConnectorPath([
                    { x: x1, y: y1 }, { x: exit, y: y1 },
                    { x: exit, y: top }, { x: end, y: top },
                    { x: end, y: targetRect.top - bounds.top },
                ]);
            } else if (sourceRect.right < targetRect.left) {
                const x2 = targetRect.left - bounds.left;
                // Finish the bend before the marker, leaving a straight approach.
                const approach = x2 - Math.min(18, (x2 - x1) / 3);
                const middle = (x1 + approach) / 2;
                path = `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${approach} ${y2} L ${x2} ${y2}`;
            } else {
                // Same-column and cyclic edges run in the right-hand gutter.
                const x2 = targetRect.right - bounds.left;
                const approach = x2 + 18;
                const outside = Math.max(x1, approach) + 14 + (index % 4) * 5;
                path = `M ${x1} ${y1} C ${outside} ${y1}, ${outside} ${y1}, ${outside} ${(y1 + y2) / 2} S ${outside} ${y2}, ${approach} ${y2} L ${x2} ${y2}`;
            }
            reference.path = svgElement("path", {
                class: "rs-codelens-memory__edge",
                d: path,
                "marker-end": `url(#${prefix}-arrow)`,
            });
            overlay.append(reference.path);
        }
        highlightReference(activeReference);
    }

    function highlightReference(link) {
        activeReference = link;
        for (const node of root.querySelectorAll(".rs-codelens-memory__card--referenced, .rs-codelens-memory__target--referenced")) {
            node.classList.remove("rs-codelens-memory__card--referenced", "rs-codelens-memory__target--referenced");
        }
        for (const reference of references) {
            const selected = reference.link === link;
            reference.path?.classList.toggle("rs-codelens-memory__edge--active", selected);
            if (selected) {
                reference.target.closest(".rs-codelens-memory__card").classList.add("rs-codelens-memory__card--referenced");
                if (reference.target.matches("th")) reference.target.classList.add("rs-codelens-memory__target--referenced");
            }
        }
    }

    function registerPointerTarget(address, node, label) {
        const id = cAddress(address);
        // An allocation/struct and its first member can share an address. The
        // containing object is registered first and remains the primary target.
        if (id && id !== "0x0" && !pointerTargets.has(id)) pointerTargets.set(id, { node, label });
    }

    function referenceLink(text, target, key, id, accessibleName) {
        const link = element("a", "rs-codelens-memory__reference", text);
        link.href = `#${target.id}`;
        link.dataset.memoryFocus = key;
        if (accessibleName) {
            link.setAttribute("aria-label", accessibleName);
            link.title = accessibleName;
        }
        link.addEventListener("click", (event) => {
            event.preventDefault();
            target.focus();
            target.scrollIntoView?.({ block: "nearest" });
        });
        references.push({ id, link, target });
        return link;
    }

    function renderValue(value, memory, key, changedKeys = new Set(), context = "") {
        if (value.kind === "struct" || value.kind === "array") {
            return table(aggregateRows(value, key), memory,
                t(value.kind === "array" ? "cl_index" : "cl_field"), t("cl_empty"), changedKeys,
                t("cl_nested_table", context, value.type));
        }
        const text = valueText(value, memory);
        if (value.kind === "pointer") {
            const placeholder = element("span", null, text);
            pendingPointers.push({ value, placeholder, key });
            return placeholder;
        }
        if (value.kind !== "reference" || !targets.has(value.id)) return element("span", null, text);
        return referenceLink(text, targets.get(value.id), key, value.id);
    }

    function table(rows, memory, keyHeading, emptyMessage, changedKeys, accessibleName, valueOnly = false) {
        if (rows.length === 0) return element("p", "rs-codelens-memory__empty", emptyMessage);
        const node = element("table", "rs-codelens-prototype__memory");
        if (valueOnly) node.classList.add("rs-codelens-memory__table--value-only");
        if (rows.some((row) => row.value.kind === "struct" || row.value.kind === "array")) {
            node.classList.add("rs-codelens-memory__table--aggregate");
        }
        if (accessibleName) node.setAttribute("aria-label", accessibleName);
        const head = element("thead");
        const header = element("tr");
        for (const name of valueOnly ? [t("cl_value")] : [keyHeading, t("cl_value")]) {
            const cell = element("th", null, name);
            cell.scope = "col";
            header.append(cell);
        }
        head.append(header);
        const body = element("tbody");
        for (const row of rows) {
            const tr = element("tr");
            const label = element("th");
            label.scope = "row";
            if (typeof row.name === "string") label.textContent = row.name;
            else label.append(renderValue(row.name, memory, `${row.key}-key`));
            if (row.value.address !== undefined) {
                const metadata = element("span", "rs-codelens-memory__variable-metadata");
                metadata.append(
                    element("span", null, t("cl_address", row.value.address)),
                    element("span", null, t("cl_type", row.value.type)),
                );
                label.append(metadata);
            }
            const cell = element("td");
            const name = typeof row.name === "string" ? row.name : valueText(row.name, memory);
            if (!valueOnly && cAddress(row.value.address)) {
                label.id = `${prefix}-address-${encodeURIComponent(row.key)}`;
                label.tabIndex = -1;
                label.dataset.memoryFocus = memoryKey(row.key, "address");
                label.setAttribute("aria-label", t("cl_pointer_target", name, row.value.type, row.value.address));
                registerPointerTarget(row.value.address, label, `${name} (${row.value.type})`);
            }
            // Use the row identity for embedded fields, independent of DOM nesting.
            cell.append(renderValue(row.value, memory, row.key, changedKeys, name));
            if (row.value.kind === "struct" || row.value.kind === "array") {
                cell.classList.add("rs-codelens-memory__aggregate-cell");
            }
            if (changedKeys.has(row.key)) {
                tr.classList.add("rs-codelens-memory__row--changed");
                cell.append(" ", element("span", "rs-codelens-memory__changed", t("cl_changed")));
            }
            if (!valueOnly) tr.append(label);
            tr.append(cell);
            body.append(tr);
        }
        node.append(head, body);
        return node;
    }

    function card(title, key, id, changedKeys) {
        const node = element("section", "rs-codelens-memory__card");
        const titleNode = element("h5", null, title);
        titleNode.id = id;
        titleNode.tabIndex = -1;
        titleNode.dataset.memoryFocus = key;
        node.setAttribute("aria-labelledby", id);
        node.append(titleNode);
        if (changedKeys.has(key)) node.append(element("p", "rs-codelens-memory__changed", t("cl_changed")));
        return { node, titleNode };
    }

    function scopeLink(id, key) {
        const label = t("cl_parent", id);
        const target = frameTargets.get(id);
        if (!target) return element("span", null, label);
        const link = element("a", null, label);
        link.href = `#${target.id}`;
        link.dataset.memoryFocus = key;
        link.addEventListener("click", (event) => {
            event.preventDefault();
            target.focus();
            target.scrollIntoView?.({ block: "nearest" });
        });
        return link;
    }

    function update(memory, changes) {
        graphical.beforeUpdate();
        const focusedKey = root.contains(document.activeElement) ? document.activeElement.dataset.memoryFocus : null;
        const changedKeys = new Set(changes.map((change) => change.key));
        references = [];
        targets = new Map();
        pointerTargets = new Map();
        pendingPointers = [];
        frameTargets = new Map();
        activeReference = null;
        const stackHeading = element("h4", null, t("cl_stack"));
        stackHeading.id = `${prefix}-stack`;
        stack.setAttribute("aria-labelledby", stackHeading.id);
        const heapHeading = element("h4", null, t("cl_heap"));
        heapHeading.id = `${prefix}-heap`;
        heap.setAttribute("aria-labelledby", heapHeading.id);
        stack.replaceChildren(stackHeading);
        heap.replaceChildren(heapHeading, heapCanvas);
        heapCanvas.replaceChildren();

        // Register every target before creating reference links, including cycles.
        const objectCards = new Map();
        for (const [id, object] of memory.objects) {
            const item = card(object.label, object.key, `${prefix}-object-${encodeURIComponent(id)}`, changedKeys);
            item.node.dataset.heapId = id;
            targets.set(id, item.titleNode);
            if (object.tag.startsWith("C_")) registerPointerTarget(id, item.titleNode, object.label);
            objectCards.set(id, item.node);
        }
        const frameCards = new Map();
        for (const frame of memory.frames) {
            const item = card(frame.label, frame.key, `${prefix}-frame-${encodeURIComponent(frame.id)}`, changedKeys);
            frameTargets.set(frame.id, item.titleNode);
            frameCards.set(frame.id, item.node);
        }
        const globals = card(t("cl_globals"), memoryKey("global"), `${prefix}-globals`, changedKeys).node;
        globals.append(table(memory.globals, memory, t("cl_name"), t("cl_no_globals"), changedKeys));
        stack.append(globals);
        for (const frame of memory.frames) {
            const node = frameCards.get(frame.id);
            if (frame.active) {
                node.classList.add("rs-codelens-memory__card--active");
                node.append(element("p", "rs-codelens-memory__frame-status", t("cl_active")));
            }
            if (frame.retained) node.append(element("p", null, t("cl_retained")));
            for (const parent of frame.parents) {
                const line = element("p");
                line.append(scopeLink(parent, memoryKey("frame", frame.id, "parent", parent)));
                node.append(line);
            }
            node.append(table(frame.bindings, memory, t("cl_name"), t("cl_no_locals"), changedKeys));
            stack.append(node);
        }
        for (const [id, object] of memory.objects) {
            const node = objectCards.get(id);
            if (object.unsupported) node.append(element("pre", "rs-codelens-memory__raw", object.unsupported));
            else {
                if (object.tag === "FUNCTION") {
                    const scope = element("p");
                    scope.append(`${t("cl_enclosing")}: `, object.enclosingFrame === null ? t("cl_global_scope") : scopeLink(object.enclosingFrame, memoryKey("heap", id, "scope")));
                    node.append(scope);
                }
                if (object.singleElement) {
                    const entry = object.entries[0];
                    const aggregate = entry.value.kind === "struct" || entry.value.kind === "array";
                    node.dataset.aggregate = String(aggregate);
                    node.append(aggregate
                        ? renderValue(entry.value, memory, entry.key, changedKeys, object.label)
                        : table(object.entries, memory, object.keyHeading, t("cl_empty"), changedKeys, object.label, true));
                } else {
                    node.append(table(object.entries, memory, object.keyHeading, t("cl_empty"), changedKeys));
                }
            }
            heapCanvas.append(node);
        }
        for (const { value, placeholder, key } of pendingPointers) {
            const target = pointerTargets.get(value.id);
            if (target) {
                const heapId = target.node.closest("[data-heap-id]")?.dataset.heapId;
                placeholder.replaceWith(referenceLink(value.text, target.node, key, heapId,
                    t("cl_pointer_reference", value.text, target.label)));
            } else {
                const description = t(value.id === "0x0" ? "cl_null_pointer" : "cl_missing_pointer");
                placeholder.title = description;
                placeholder.append(element("span", "rs-codelens-prototype__sr-only", ` (${description})`));
            }
        }
        let stackDepth = 0;
        let heapDepth = 0;
        for (const node of [...stack.querySelectorAll(".rs-codelens-memory__card"), ...objectCards.values()]) {
            let depth = node.dataset.aggregate === "true" ? 1 : 0;
            for (const nested of node.querySelectorAll("table")) {
                let level = 0;
                let parent = nested.parentElement.closest("table");
                while (parent && node.contains(parent)) {
                    level++;
                    parent = parent.parentElement.closest("table");
                }
                depth = Math.max(depth, level);
            }
            node.style.setProperty("--cl-card-width", `${16 + depth * 10}rem`);
            if (node.dataset.heapId !== undefined) heapDepth = Math.max(heapDepth, depth);
            else stackDepth = Math.max(stackDepth, depth);
        }
        stage.style.setProperty("--cl-stack-width", `${16 + stackDepth * 10}rem`);
        stage.style.setProperty("--cl-heap-width", `${16 + heapDepth * 10}rem`);
        stage.dataset.hasNested = String(stackDepth > 0 || heapDepth > 0);
        graphical.sync(objectCards, references);
        changeSummary.textContent = t("cl_changes", changes.length);
        changeList.replaceChildren(...changes.map((change) => element("li", null, change.text)));
        changeDetails.hidden = changes.length === 0;
        if (focusedKey) {
            const replacement = [...root.querySelectorAll("[data-memory-focus]")].find((node) => node.dataset.memoryFocus === focusedKey);
            (replacement ?? heading).focus();
        }
        scheduleDraw();
    }

    stage.addEventListener("focusin", (event) => highlightReference(event.target.closest(".rs-codelens-memory__reference")));
    stage.addEventListener("focusout", () => highlightReference(null));
    stage.addEventListener("pointerover", (event) => {
        const link = event.target.closest(".rs-codelens-memory__reference");
        if (link) highlightReference(link);
    });
    stage.addEventListener("pointerout", () => highlightReference(document.activeElement.closest?.(".rs-codelens-memory__reference")));
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleDraw) : null;
    resizeObserver?.observe(stage);
    window.addEventListener("resize", scheduleDraw);
    return {
        element: root,
        update,
        destroy() {
            destroyed = true;
            graphical.destroy();
            resizeObserver?.disconnect();
            window.removeEventListener("resize", scheduleDraw);
            if (pendingDraw !== null) window.cancelAnimationFrame(pendingDraw);
        },
    };
}
