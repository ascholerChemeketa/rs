// Breakpoints and the CodeMirror 6 code panel, without the jQuery globals shim.
import { beforeEach, describe, expect, it } from "vitest";
import { mountTraceViewer } from "../frontend/trace-viewer.js";
import graph from "../frontend/fixtures/memory-graph.json";

// memory-graph executes lines 1, 6, 7, 8, 9, 2, 3, 4, 4, 9 and starts at step 6.
const key = "breakpoint-test";
const button = (container, action) => container.querySelector(`button[data-codelens-action="${action}"]`);
const status = (container) => container.querySelector(".rs-codelens-prototype__status");

beforeEach(() => {
    document.body.innerHTML = '<div id="viewer"></div>';
    window.localStorage.clear();
});

describe("CodeLens breakpoints", () => {
    it("offers labeled step buttons with icons in order", () => {
        const container = document.getElementById("viewer");
        mountTraceViewer(container, graph);
        const buttons = [...container.querySelectorAll(".rs-codelens-prototype__code-panel .rs-codelens-prototype__controls button")];
        expect(buttons.map((node) => node.textContent)).toEqual([
            "Start", "Previous breakpoint", "Previous line", "Next line", "Next breakpoint", "End",
        ]);
        for (const node of buttons) expect(node.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
        expect(button(container, "prevbp").getAttribute("aria-disabled")).toBe("true");
        expect(button(container, "nextbp").getAttribute("aria-disabled")).toBe("true");
    });

    it("jumps to the start and end", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        button(container, "first").click();
        expect(viewer.currentStep).toBe(0);
        expect(button(container, "first").getAttribute("aria-disabled")).toBe("true");
        button(container, "last").click();
        expect(viewer.currentStep).toBe(9);
        expect(button(container, "last").getAttribute("aria-disabled")).toBe("true");
        expect(viewer.goToEnd()).toBe(false);
    });

    it("stops where execution arrives on a breakpoint line, in both directions", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph, { startingInstruction: 0 });
        expect(viewer.toggleBreakpoint(4)).toBe(true);
        expect(viewer.toggleBreakpoint(9)).toBe(true);
        button(container, "nextbp").click();
        expect(viewer.currentStep).toBe(4);
        expect(status(container).textContent).toMatch(/^Stopped at breakpoint\. Step 5 of 10\. Line 9\./);
        viewer.nextBreakpoint();
        expect(viewer.currentStep).toBe(7);
        // Step 8 repeats line 4, so the next stop is the second visit to line 9.
        viewer.nextBreakpoint();
        expect(viewer.currentStep).toBe(9);
        expect(button(container, "nextbp").getAttribute("aria-disabled")).toBe("true");
        viewer.previousBreakpoint();
        expect(viewer.currentStep).toBe(7);
        viewer.previousBreakpoint();
        expect(viewer.currentStep).toBe(4);
        expect(viewer.previousBreakpoint()).toBe(false);
    });

    it("ignores lines that never execute and announces changes", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph, { breakpointKey: key });
        expect(viewer.toggleBreakpoint(5)).toBe(false);
        viewer.toggleBreakpoint(3);
        expect(status(container).textContent).toBe("Breakpoint set on line 3.");
        viewer.toggleBreakpoint(3);
        expect(status(container).textContent).toBe("Breakpoint removed from line 3.");
        expect(viewer.breakpoints).toEqual([]);
        expect(window.localStorage.getItem(`codelens-breakpoints:${key}`)).toBeNull();
    });

    it("remembers breakpoints per visualizer in local storage", () => {
        const container = document.getElementById("viewer");
        const first = mountTraceViewer(container, graph, { breakpointKey: key });
        first.toggleBreakpoint(7);
        first.toggleBreakpoint(2);
        expect(JSON.parse(window.localStorage.getItem(`codelens-breakpoints:${key}`)).sort()).toEqual([2, 7]);
        const second = mountTraceViewer(container, graph, { breakpointKey: key });
        expect(second.breakpoints).toEqual([2, 7]);
        expect(mountTraceViewer(container, graph, { breakpointKey: "other" }).breakpoints).toEqual([]);
        window.localStorage.setItem(`codelens-breakpoints:${key}`, "not json");
        expect(mountTraceViewer(container, graph, { breakpointKey: key }).breakpoints).toEqual([]);
    });

    // Gutter clicks need real layout to map to a line, so they are checked in
    // the browser demo; jsdom covers the markers they produce.
    it("marks the current line and breakpoints for screen readers", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        const lines = () => [...container.querySelectorAll(".cm-line")];
        expect(lines()[2].classList.contains("rs-codelens-code__line--current")).toBe(true);
        expect(lines()[2].textContent).toContain("Line 3: Current line.");
        viewer.toggleBreakpoint(7);
        expect(lines()[6].textContent).toContain("Breakpoint.");
        expect(lines()[6].classList.contains("rs-codelens-code__line--breakpoint")).toBe(true);
        viewer.destroy();
    });

    it("switches between the VS Code light and dark themes with the page", async () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        const editor = container.querySelector(".cm-editor");
        const light = editor.className;
        document.documentElement.dataset.theme = "dark";
        await Promise.resolve(); // MutationObserver callbacks run as microtasks.
        const dark = editor.className;
        expect(dark).not.toBe(light);
        document.documentElement.dataset.theme = "light";
        await Promise.resolve();
        expect(editor.className).toBe(light);
        document.documentElement.classList.add("dark-mode");
        await Promise.resolve();
        expect(editor.className).toBe(dark);
        document.documentElement.classList.remove("dark-mode");
        delete document.documentElement.dataset.theme;
        viewer.destroy();
    });
});
