// No jQuery shim: all layouts share the same native, semantic memory tree.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountTraceViewer } from "../frontend/trace-viewer.js";
import graph from "../frontend/fixtures/memory-graph.json";

const layout = vi.hoisted(() => vi.fn());
vi.mock("../frontend/elk-layout.js", () => ({ layoutHeap: layout }));

let viewer;
let root;
const button = (name) => [...root.querySelectorAll("button")].find((node) => node.textContent === name);
const card = (id) => root.querySelector(`[data-heap-id="${id}"]`);
const selectMode = (mode) => root.querySelector(`input[value="${mode}"]`).click();
const positions = () => [...root.querySelectorAll("[data-heap-id]")].map((node) => [node.dataset.heapId, node.style.left, node.style.top]);
const arranged = () => vi.waitFor(() => {
    expect(root.textContent).toContain("Heap objects arranged.");
});

beforeEach(() => {
    viewer?.destroy();
    document.body.innerHTML = '<div id="viewer"></div>';
    root = document.getElementById("viewer");
    layout.mockReset();
    layout.mockImplementation(async (nodes) => ({
        positions: new Map(nodes.map((node, index) => [node.id, { x: 24 + index * 400, y: 24 }])),
        routes: new Map(),
    }));
    viewer = mountTraceViewer(root, graph);
});

describe("Graphical Diagram", () => {
    it("loads layout only on request and keeps the same cards and semantic references in all views", async () => {
        const original = card("3");
        expect(layout).not.toHaveBeenCalled();
        selectMode("text");
        expect(layout).not.toHaveBeenCalled();
        selectMode("graphical");
        await arranged();
        expect(layout).toHaveBeenCalledOnce();
        expect(layout.mock.calls[0][0]).toHaveLength(3);
        expect(layout.mock.calls[0][1].some((edge) => edge.source === "3" && edge.target === "3")).toBe(true);
        expect(card("3")).toBe(original);
        expect(original.querySelector("a").textContent).toBe("Reference to List 2");
        const placed = positions();
        selectMode("diagram");
        expect(original.style.left).toBe("");
        selectMode("graphical");
        expect(positions()).toEqual(placed);
        expect(layout).toHaveBeenCalledOnce();
    });

    it("supports clicking and keyboard movement while keeping positions across trace and view changes", async () => {
        selectMode("graphical");
        await arranged();
        const select = root.querySelector(".rs-codelens-memory__movement select");
        select.value = "2";
        select.dispatchEvent(new Event("change"));
        const right = button("Move right");
        right.focus();
        right.click();
        expect(card("2").style.left).toBe("440px");
        expect(card("1").style.left).toBe("24px");
        expect(document.activeElement).toBe(right);
        expect(root.textContent).toContain("List 2 positioned at 440, 24.");
        button("Move List 2").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
        expect(card("2").style.top).toBe("88px");
        const placed = positions();
        viewer.stepForward();
        viewer.stepBackward();
        expect(positions()).toEqual(placed);
        selectMode("text");
        selectMode("graphical");
        expect(positions()).toEqual(placed);
        expect(layout).toHaveBeenCalledOnce();
        button("Arrange automatically").click();
        await vi.waitFor(() => expect(card("2").style.left).toBe("424px"));
        button("Reset positions").click();
        await vi.waitFor(() => expect(layout).toHaveBeenCalledTimes(3));
    });

    it("retains a removed object's position when stepping backward", async () => {
        viewer.destroy();
        viewer = mountTraceViewer(root, {
            code: "x = []\ndel x",
            trace: [
                { line: 1, globals: { x: ["REF", 1] }, heap: { 1: ["LIST"] } },
                { line: 2, globals: {}, heap: {} },
            ],
        });
        selectMode("graphical");
        await arranged();
        button("Move right").click();
        expect(card("1").style.left).toBe("40px");
        viewer.stepForward();
        expect(button("Move right").disabled).toBe(true);
        viewer.stepBackward();
        expect(card("1").style.left).toBe("40px");
        expect(layout).toHaveBeenCalledOnce();
    });

    it("places a new object without moving a user-positioned object", async () => {
        viewer.destroy();
        viewer = mountTraceViewer(root, {
            code: "x = []\ny = [x]",
            trace: [
                { line: 1, heap: { 1: ["LIST"] } },
                { line: 2, heap: { 1: ["LIST"], 2: ["LIST", ["REF", 1]] } },
            ],
        });
        selectMode("graphical");
        await arranged();
        button("Move right").click();
        const position = card("1").style.left;
        viewer.stepForward();
        await arranged();
        expect(card("1").style.left).toBe(position);
        expect(card("2").style.left).toBe("424px");
        expect(layout).toHaveBeenCalledTimes(2);
        viewer.stepBackward();
        expect(card("1").style.left).toBe(position);
    });

    it("ignores a stale layout after switching away and preserves a user move during layout", async () => {
        let complete;
        layout.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        selectMode("graphical");
        const initial = positions();
        selectMode("text");
        complete({ positions: new Map([["1", { x: 900, y: 900 }]]), routes: new Map() });
        await Promise.resolve();
        expect(card("1").style.left).toBe("");
        expect(root.querySelector(".rs-codelens-memory__graph-controls").hidden).toBe(true);
        layout.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        selectMode("graphical");
        button("Move right").click();
        const moved = positions();
        expect(moved).not.toEqual(initial);
        complete({ positions: new Map([["1", { x: 900, y: 900 }]]), routes: new Map() });
        await Promise.resolve();
        expect(positions()).toEqual(moved);
    });

    it("keeps movement available if ELK fails and allows a retry", async () => {
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        layout.mockRejectedValueOnce(new Error("Network unavailable"));
        selectMode("graphical");
        await vi.waitFor(() => expect(root.textContent).toContain("Automatic layout is unavailable."));
        button("Move right").click();
        expect(root.textContent).toContain("Function 1 positioned at 40, 24.");
        button("Arrange automatically").click();
        await arranged();
        warning.mockRestore();
    });

    it("cancels dragging with Escape or pointer cancellation and restores the starting position", async () => {
        selectMode("graphical");
        await arranged();
        const handle = button("Move List 2");
        handle.setPointerCapture = vi.fn();
        handle.hasPointerCapture = () => true;
        handle.releasePointerCapture = vi.fn();
        const original = positions();
        const pointer = (type, x, y) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: y });
            handle.dispatchEvent(event);
        };
        pointer("pointerdown", 40, 40);
        pointer("pointermove", 100, 80);
        expect(card("2").style.left).toBe("484px");
        expect(card("2").style.top).toBe("64px");
        expect(document.activeElement).toBe(handle);
        handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(positions()).toEqual(original);
        pointer("pointerdown", 40, 40);
        pointer("pointermove", 100, 80);
        pointer("pointercancel", 100, 80);
        expect(positions()).toEqual(original);
    });
});
