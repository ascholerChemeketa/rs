import { t } from "../../common/js/rsi18n.js";
import { layoutHeap } from "./elk-layout.js";

const padding = 24;
const directions = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
}

function sizeOf(card) {
    const rect = card.getBoundingClientRect();
    return {
        width: rect.width || parseFloat(card.style.getPropertyValue("--cl-card-width")) * 16 || 256,
        height: rect.height || 100 + card.querySelectorAll("tbody tr").length * 32,
    };
}

function freePosition(candidate, size, occupied) {
    const position = { x: Math.max(padding, candidate.x), y: Math.max(padding, candidate.y) };
    // Place newly appearing objects without moving existing or manually placed ones.
    for (let attempt = 0; attempt <= occupied.length; attempt++) {
        const collision = occupied.find((other) =>
            position.x < other.x + other.width + padding &&
            position.x + size.width + padding > other.x &&
            position.y < other.y + other.height + padding &&
            position.y + size.height + padding > other.y,
        );
        if (!collision) break;
        position.y = collision.y + collision.height + padding;
    }
    return position;
}

/** Own positions and interactions; the semantic cards still belong to memory-view. */
export function createGraphicalHeap({ canvas, prefix, onChange }) {
    const controls = element("div");
    controls.className = "rs-codelens-memory__graph-controls";
    controls.hidden = true;
    const help = element("p", t("cl_graph_help"));
    help.id = `${prefix}-graph-help`;
    const actions = element("div");
    actions.className = "rs-codelens-prototype__controls";
    const arrange = element("button", t("cl_arrange"));
    const reset = element("button", t("cl_reset_positions"));
    const label = element("label", t("cl_move_object"));
    const select = element("select");
    select.id = `${prefix}-move-object`;
    label.htmlFor = select.id;
    const movement = element("div");
    movement.className = "rs-codelens-memory__movement";
    const moveButtons = [];
    for (const direction of Object.keys(directions)) {
        const button = element("button", t(`cl_move_${direction}`));
        button.type = "button";
        button.addEventListener("click", () => moveSelected(direction));
        moveButtons.push(button);
        movement.append(button);
    }
    const status = element("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-atomic", "true");
    arrange.type = reset.type = "button";
    actions.append(arrange, reset);
    movement.prepend(label, select);
    controls.append(help, actions, movement, status);

    let cards = new Map();
    let references = [];
    const positions = new Map(); // Retain absent objects too, for backward stepping.
    const committed = new Set();
    let routes = new Map();
    let routeGeometry = null;
    let selectedId = null;
    let enabled = false;
    let destroyed = false;
    let revision = 0;
    let busy = false;
    let drag = null;
    const sizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => { if (enabled && !destroyed) applyPositions(); })
        : null;

    function message(key, ...args) {
        const text = t(key, ...args);
        if (status.textContent !== text) status.textContent = text;
    }

    function revealObject(id) {
        const viewport = canvas.closest(".rs-codelens-memory__viewport");
        if (!enabled || !viewport || !cards.has(id)) return;
        const bounds = viewport.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const node = cards.get(id).getBoundingClientRect();
        const right = node.left + Math.min(node.width, viewport.clientWidth - 16);
        const bottom = node.top + Math.min(node.height, viewport.clientHeight - 16);
        // Scroll only the graph, so the movement controls stay in place.
        if (node.left < bounds.left + 8) viewport.scrollLeft -= bounds.left + 8 - node.left;
        else if (right > bounds.left + viewport.clientWidth - 8) viewport.scrollLeft += right - bounds.left - viewport.clientWidth + 8;
        if (node.top < bounds.top + 8) viewport.scrollTop -= bounds.top + 8 - node.top;
        else if (bottom > bounds.top + viewport.clientHeight - 8) viewport.scrollTop += bottom - bounds.top - viewport.clientHeight + 8;
    }

    function setBusy(value) {
        busy = value;
        arrange.setAttribute("aria-disabled", String(value || cards.size === 0));
        reset.setAttribute("aria-disabled", String(value || cards.size === 0));
    }

    function selectObject(id) {
        selectedId = cards.has(id) ? id : (cards.keys().next().value ?? null);
        select.value = selectedId ?? "";
        for (const [objectId, card] of cards) {
            card.classList.toggle("rs-codelens-memory__card--selected", objectId === selectedId);
        }
        select.disabled = cards.size === 0;
        moveButtons.forEach((button) => { button.disabled = cards.size === 0; });
    }

    function applyPositions() {
        if (!enabled) return;
        let width = 320;
        let height = 260;
        for (const [id, card] of cards) {
            const position = positions.get(id);
            if (!position) continue;
            card.style.left = `${position.x}px`;
            card.style.top = `${position.y}px`;
            const size = sizeOf(card);
            width = Math.max(width, position.x + size.width + 48);
            height = Math.max(height, position.y + size.height + 48);
        }
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        onChange();
    }

    function ensurePositions() {
        const occupied = [];
        for (const [id, card] of cards) {
            if (positions.has(id)) occupied.push({ ...positions.get(id), ...sizeOf(card) });
        }
        for (const [id, card] of cards) {
            if (positions.has(id)) continue;
            const size = sizeOf(card);
            const position = freePosition({ x: padding, y: padding }, size, occupied);
            positions.set(id, position);
            occupied.push({ ...position, ...size });
        }
        applyPositions();
    }

    function measureGraph() {
        const nodes = [...cards].map(([id, card]) => {
            const bounds = card.getBoundingClientRect();
            const heading = card.querySelector("h5").getBoundingClientRect();
            return { id, ...sizeOf(card), targetY: heading.height ? heading.top + heading.height / 2 - bounds.top : 24 };
        });
        const edges = references.flatMap((reference) => {
            const source = reference.link.closest("[data-heap-id]");
            if (!source || !cards.has(reference.id)) return [];
            const bounds = source.getBoundingClientRect();
            const link = reference.link.closest("td, th").getBoundingClientRect();
            return [{
                key: reference.link.dataset.memoryFocus,
                source: source.dataset.heapId,
                target: reference.id,
                y: link.height ? link.top + link.height / 2 - bounds.top : 64,
            }];
        });
        return { nodes, edges };
    }

    async function runLayout(replaceAll = false) {
        if (!enabled || destroyed || cards.size === 0) return;
        const targets = new Set([...cards.keys()].filter((id) => replaceAll || !committed.has(id)));
        if (targets.size === 0) {
            message("cl_positions_kept");
            return;
        }
        const request = ++revision;
        const isCurrent = () => request === revision && enabled && !destroyed;
        const geometry = measureGraph();
        setBusy(true);
        message("cl_arranging");
        try {
            const result = await layoutHeap(geometry.nodes, geometry.edges, isCurrent);
            if (!isCurrent() || !result) return;
            const occupied = [...cards].filter(([id]) => !targets.has(id))
                .map(([id, card]) => ({ ...positions.get(id), ...sizeOf(card) }));
            for (const node of geometry.nodes) {
                if (!targets.has(node.id)) continue;
                const desired = result.positions.get(node.id);
                const position = replaceAll || targets.size === cards.size
                    ? desired : freePosition(desired, node, occupied);
                positions.set(node.id, position);
                committed.add(node.id);
                occupied.push({ ...position, ...node });
            }
            routes = result.routes;
            routeGeometry = { ...geometry, positions: result.positions };
            setBusy(false);
            message("cl_arranged");
            applyPositions();
        } catch (error) {
            if (!isCurrent()) return;
            setBusy(false);
            message("cl_layout_failed");
            // Existing positions and the other views remain usable; Arrange retries.
            console.warn("CodeLens heap layout failed", error);
        }
    }

    function announcePosition(id) {
        const position = positions.get(id);
        const name = cards.get(id).querySelector("h5").textContent;
        message("cl_node_position", name, Math.round(position.x), Math.round(position.y));
    }

    function moveObject(id, x, y, announce = true) {
        if (!enabled || !cards.has(id)) return;
        revision++; // An in-flight automatic layout must not overwrite a user move.
        setBusy(false);
        routes.clear();
        positions.set(id, { x: Math.max(padding, x), y: Math.max(padding, y) });
        committed.add(id);
        selectObject(id);
        applyPositions();
        if (announce) {
            announcePosition(id);
            revealObject(id);
        }
    }

    function moveSelected(direction, distance = 16) {
        if (!selectedId || !enabled) return;
        const [dx, dy] = directions[direction];
        const position = positions.get(selectedId);
        moveObject(selectedId, position.x + dx * distance, position.y + dy * distance);
    }

    function finishDrag(cancelled = false) {
        if (!drag) return;
        const previous = drag;
        drag = null;
        if (previous.handle.hasPointerCapture?.(previous.pointerId)) {
            previous.handle.releasePointerCapture(previous.pointerId);
        }
        previous.handle.classList.remove("rs-codelens-memory__dragging");
        if (cancelled) moveObject(previous.id, previous.x, previous.y);
        else announcePosition(previous.id);
    }

    function addHandle(card, id) {
        const handle = element("button", t("cl_move_node", card.querySelector("h5").textContent));
        handle.type = "button";
        handle.className = "rs-codelens-memory__move-handle";
        handle.dataset.memoryFocus = JSON.stringify(["heap", id, "move"]);
        handle.setAttribute("aria-describedby", help.id);
        handle.addEventListener("click", () => selectObject(id));
        handle.addEventListener("pointerdown", (event) => {
            if (!enabled || event.button !== 0 || drag) return;
            event.preventDefault();
            selectObject(id);
            handle.focus({ preventScroll: true });
            const position = positions.get(id);
            drag = { id, ...position, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, handle };
            handle.setPointerCapture(event.pointerId);
            handle.classList.add("rs-codelens-memory__dragging");
        });
        handle.addEventListener("pointermove", (event) => {
            if (!drag || drag.handle !== handle || drag.pointerId !== event.pointerId) return;
            moveObject(id, drag.x + event.clientX - drag.clientX, drag.y + event.clientY - drag.clientY, false);
        });
        handle.addEventListener("pointerup", () => finishDrag());
        handle.addEventListener("pointercancel", () => finishDrag(true));
        handle.addEventListener("lostpointercapture", () => finishDrag(true));
        handle.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && drag) {
                event.preventDefault();
                finishDrag(true);
            }
            const direction = event.key.replace("Arrow", "").toLowerCase();
            if (!directions[direction]) return;
            event.preventDefault();
            selectObject(id);
            moveSelected(direction, event.shiftKey ? 64 : 16);
        });
        card.querySelector("h5").after(handle);
    }

    select.addEventListener("change", () => {
        selectObject(select.value);
        revealObject(selectedId);
    });
    arrange.addEventListener("click", () => { if (!busy) void runLayout(true); });
    reset.addEventListener("click", () => {
        if (busy || cards.size === 0) return;
        positions.clear();
        committed.clear();
        ensurePositions();
        void runLayout(true);
    });

    function beforeUpdate() {
        finishDrag(true);
        revision++;
        sizeObserver?.disconnect();
        if (busy) message("cl_positions_kept");
        setBusy(false);
    }

    return {
        element: controls,
        beforeUpdate,
        sync(nextCards, nextReferences) {
            cards = nextCards;
            references = nextReferences;
            select.replaceChildren(...[...cards].map(([id, card]) => {
                const option = element("option", card.querySelector("h5").textContent);
                option.value = id;
                addHandle(card, id);
                return option;
            }));
            selectObject(selectedId);
            setBusy(false);
            if (cards.size === 0) status.textContent = "";
            if (enabled) {
                for (const card of cards.values()) sizeObserver?.observe(card);
                ensurePositions();
                void runLayout();
            }
        },
        setEnabled(value) {
            beforeUpdate();
            enabled = value;
            controls.hidden = !value;
            if (value) {
                for (const card of cards.values()) sizeObserver?.observe(card);
                ensurePositions();
                void runLayout();
            } else {
                canvas.style.removeProperty("width");
                canvas.style.removeProperty("height");
                for (const card of cards.values()) {
                    card.style.removeProperty("left");
                    card.style.removeProperty("top");
                }
            }
            onChange();
        },
        routeFor(reference) {
            if (!enabled || !routeGeometry) return null;
            // ELK's shared target port is at the card heading. A pointer to an
            // interior field uses the live cell geometry instead.
            if (reference.target && !reference.target.matches("h5")) return null;
            const key = reference.link.dataset.memoryFocus;
            const edge = routeGeometry.edges.find((item) => item.key === key);
            if (!edge) return null;
            for (const id of [edge.source, edge.target]) {
                const expected = routeGeometry.positions.get(id);
                const actual = positions.get(id);
                const size = cards.has(id) && sizeOf(cards.get(id));
                const oldSize = routeGeometry.nodes.find((node) => node.id === id);
                if (!actual || !size || actual.x !== expected.x || actual.y !== expected.y ||
                    Math.abs(size.width - oldSize.width) > 1 || Math.abs(size.height - oldSize.height) > 1) return null;
            }
            const source = cards.get(edge.source).getBoundingClientRect();
            const link = reference.link.closest("td, th").getBoundingClientRect();
            if (link.height && Math.abs(link.top + link.height / 2 - source.top - edge.y) > 1) return null;
            return routes.get(key) ?? null;
        },
        destroy() {
            beforeUpdate();
            destroyed = true;
        },
    };
}
