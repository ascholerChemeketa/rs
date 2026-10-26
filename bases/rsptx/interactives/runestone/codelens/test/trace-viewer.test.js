// The prototype viewer must work without the jQuery globals shim.
import { beforeEach, describe, expect, it } from "vitest";
import { mountTraceViewer } from "../frontend/trace-viewer.js";
import hello from "../frontend/fixtures/hello-world.json";
import loop from "../frontend/fixtures/loop-output.json";
import sieve from "../frontend/fixtures/sieve.json";
import graph from "../frontend/fixtures/memory-graph.json";
import aliases from "../frontend/fixtures/aliasing.json";

beforeEach(() => {
    document.body.innerHTML = '<div id="viewer"></div><div id="other"></div>';
});

describe("CodeLens trace viewer prototype", () => {
    it("renders named nested struct tables, widens cards, and marks only the changed field", () => {
        const snapshot = (x) => ({ globals: { record: ["C_STRUCT", "0x10", "Record",
            ["point", ["C_STRUCT", "0x10", "Point", ["x", ["C_DATA", "0x10", "int", x]],
                ["link", ["REF", "0x20"]]]],
        ] }, heap: { "0x20": ["LIST", 1] } });
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, { code: "example", trace: [snapshot(1), snapshot(2)] }, { lang: "cpp" });
        const nested = container.querySelector('table[aria-label="point: Point members"]');
        expect(nested).toBeTruthy();
        expect(nested.querySelector('th[scope="col"]').textContent).toBe("Field");
        expect(nested.querySelector('th[scope="row"]').textContent).toContain("Address: 0x10");
        expect(nested.querySelector("a").closest("td").closest("table")).toBe(nested);
        const card = nested.closest(".rs-codelens-memory__card");
        expect(card.style.getPropertyValue("--cl-card-width")).toBe("36rem");
        viewer.stepForward();
        const changed = container.querySelectorAll(".rs-codelens-memory__row--changed");
        expect(changed).toHaveLength(1);
        expect(changed[0].querySelector("th").firstChild.textContent).toBe("x");
        container.querySelector('input[value="text"]').click();
        expect(container.querySelectorAll('table[aria-label]')).toHaveLength(2);
        viewer.destroy();
    });

    it("shows a source line and advances one snapshot with a native button", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, hello);
        const next = container.querySelector("button[data-codelens-action=fwd]");

        expect(next.textContent).toBe("Next step");
        expect(next.getAttribute("aria-disabled")).toBe("false");
        expect(viewer.currentStep).toBe(0);
        expect(container.querySelector('[data-line="1"]')).toHaveProperty(
            "textContent",
            expect.stringContaining("Current line"),
        );
        expect(container.querySelector('[role="status"]').textContent).toContain(
            "Step 1 of 2. Line 1.",
        );

        next.focus();
        next.click();
        expect(viewer.currentStep).toBe(1);
        expect(document.activeElement).toBe(next);
        expect(next.getAttribute("aria-disabled")).toBe("true");
        expect(container.querySelector(".rs-codelens-prototype__output").textContent).toBe(
            "Hello, World!\n",
        );
        expect(container.querySelector('[role="status"]').textContent).toContain(
            "New output: Hello, World!",
        );
        expect(viewer.stepForward()).toBe(false);
    });

    it("reserves heap space only when some step in the trace uses it", () => {
        const container = document.getElementById("viewer");
        mountTraceViewer(container, loop);
        const stage = container.querySelector(".rs-codelens-memory__stage");
        expect(stage.dataset.hasHeap).toBe("false");
        expect(container.querySelector(".rs-codelens-memory__column--heap").hidden).toBe(true);
        const graphical = container.querySelector('input[value="graphical"]');
        graphical.click();
        expect(container.querySelector(".rs-codelens-memory__graph-controls").hidden).toBe(true);
        expect(container.textContent).not.toContain("No heap objects at this step.");

        mountTraceViewer(container, sieve, { startingInstruction: 0 });
        expect(container.querySelector(".rs-codelens-memory__stage").dataset.hasHeap).toBe("true");
        expect(container.querySelector(".rs-codelens-memory__column--heap").hidden).toBe(false);
        expect(container.textContent).not.toContain("No heap objects at this step.");
    });

    it("updates accessible variable rows and program output", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, loop);
        viewer.stepForward();

        expect(container.querySelector("tbody th[scope=row]").textContent).toBe("i");
        expect(container.querySelector("tbody td > span").textContent).toBe("0");
        expect(container.querySelector('[role="status"]').textContent).toContain(
            "Global variables, i added: 0.",
        );

        viewer.stepForward();
        expect(container.querySelector(".rs-codelens-prototype__output").textContent).toBe(
            "0\n",
        );
    });

    it("honors a nonzero starting instruction and renders its frame and heap", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, sieve);

        expect(viewer.currentStep).toBe(72);
        expect(container.querySelector('[role="status"]').textContent).toContain(
            "Step 73 of 127.",
        );
        const frame = [...container.querySelectorAll("h5")].find((node) => node.textContent.includes("SieveOfEratosthenes — frame 1"));
        expect(frame).toBeTruthy();
        expect(frame.parentElement.textContent).toContain("Active frame");
        const prime = [...frame.parentElement.querySelectorAll("a")].find((node) => node.textContent === "Reference to List 3");
        const target = document.getElementById(prime.hash.slice(1));
        expect(target.textContent).toBe("List 3");
        expect(target.parentElement.querySelectorAll("tbody tr")).toHaveLength(21);
        expect(target.parentElement.textContent).toContain("False");
    });

    it("keeps two viewers independent and never treats trace text as HTML", () => {
        const first = document.getElementById("viewer");
        const second = document.getElementById("other");
        const modified = {
            code: '<img src=x onerror="alert(1)">',
            trace: [
                { line: 1, globals: { value: "<b>hello</b>" }, stdout: "" },
                { line: 1, globals: {}, stdout: "" },
            ],
        };
        const one = mountTraceViewer(first, modified);
        const two = mountTraceViewer(second, hello);

        expect(document.querySelectorAll("img, b")).toHaveLength(0);
        expect(first.querySelector(".rs-codelens-prototype__source").textContent).toContain(
            "<img",
        );
        first.querySelector("button[data-codelens-action=fwd]").click();
        expect(one.currentStep).toBe(1);
        expect(two.currentStep).toBe(0);
        expect(document.querySelectorAll("#jmpStepFwd")).toHaveLength(0);
    });

    it("switches layouts without replacing memory or losing radio focus and keeps the view when stepping", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        const stage = container.querySelector(".rs-codelens-memory__stage");
        const heapHeading = [...stage.querySelectorAll("h5")].find((node) => node.textContent === "Dictionary 3");
        const text = container.querySelector('input[value="text"]');
        expect(stage.dataset.view).toBe("diagram");
        text.focus();
        text.click();
        expect(stage.dataset.view).toBe("text");
        expect(document.activeElement).toBe(text);
        expect(document.getElementById(heapHeading.id)).toBe(heapHeading);
        expect(stage.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
        expect(stage.querySelector("svg").getAttribute("focusable")).toBe("false");
        expect(stage.getAttribute("aria-hidden")).toBeNull();
        viewer.stepForward();
        expect(stage.dataset.view).toBe("text");
        expect(text.checked).toBe(true);
        expect(document.activeElement).toBe(text);
    });

    it("links aliases and a cycle to a single object and moves focus to its heading", () => {
        const container = document.getElementById("viewer");
        mountTraceViewer(container, graph);
        const links = [...container.querySelectorAll("a")].filter((link) => link.textContent === "Reference to Dictionary 3");
        expect(links).toHaveLength(4); // global node, two locals, and self-reference
        expect(new Set(links.map((link) => link.href)).size).toBe(1);
        const target = document.getElementById(links[0].hash.slice(1));
        expect(target.parentElement.querySelectorAll("tbody tr")).toHaveLength(2);
        links[0].focus();
        expect(target.parentElement.classList.contains("rs-codelens-memory__card--referenced")).toBe(true);
        links[0].click();
        expect(document.activeElement).toBe(target);
    });

    it("announces a heap mutation once and provides a complete change list", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        viewer.stepForward();
        const status = container.querySelector('[role="status"]');
        expect(status.textContent).toContain("List 2, index 2 added: 3.");
        expect(status.textContent).not.toContain("Reference to Dictionary");
        const changes = container.querySelector(".rs-codelens-memory__changes");
        expect(changes.hidden).toBe(false);
        expect(changes.querySelectorAll("li")).toHaveLength(1);
        expect(container.querySelectorAll(".rs-codelens-memory__row--changed")).toHaveLength(1);
        viewer.stepForward();
        expect(status.textContent).toContain("Return value added: Reference to Dictionary 3.");
        viewer.stepForward();
        expect(status.textContent).toContain("visit — frame 1 removed.");
    });

    it("steps backward through memory changes while preserving focus and the selected view", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        const previous = container.querySelector('button[data-codelens-action="back"]');
        expect(previous.textContent).toBe("Previous step");
        expect(previous.getAttribute("aria-disabled")).toBe("false");
        container.querySelector('input[value="text"]').click();
        viewer.stepForward();
        previous.focus();
        previous.click();

        expect(viewer.currentStep).toBe(6);
        expect(document.activeElement).toBe(previous);
        expect(container.querySelector('input[value="text"]').checked).toBe(true);
        const list = [...container.querySelectorAll("h5")].find((node) => node.textContent === "List 2");
        expect(list.parentElement.querySelectorAll("tbody tr")).toHaveLength(2);
        expect(container.querySelector('[role="status"]').textContent).toContain(
            "List 2, index 2 removed (was 3).",
        );
    });

    it("restores output and navigation boundaries when stepping back to the first snapshot", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, hello);
        const previous = container.querySelector('button[data-codelens-action="back"]');
        const next = container.querySelector('button[data-codelens-action="fwd"]');
        expect(previous.getAttribute("aria-disabled")).toBe("true");
        expect(viewer.stepBackward()).toBe(false);
        next.click();
        previous.focus();
        previous.click();

        expect(viewer.currentStep).toBe(0);
        expect(document.activeElement).toBe(previous);
        expect(previous.getAttribute("aria-disabled")).toBe("true");
        expect(next.getAttribute("aria-disabled")).toBe("false");
        expect(container.querySelector(".rs-codelens-prototype__output").textContent).toBe("");
        expect(container.querySelector('[role="status"]').textContent).toContain("Program output changed.");
        previous.click();
        expect(viewer.currentStep).toBe(0);
        viewer.destroy();
        expect(viewer.stepBackward()).toBe(false);
    });

    it("keeps IDs and view controls independent between viewers, including imported aliasing data", () => {
        const container = document.getElementById("viewer");
        const other = document.getElementById("other");
        mountTraceViewer(container, aliases, { startingInstruction: 4 });
        mountTraceViewer(other, aliases, { startingInstruction: 4 });
        const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
        container.querySelector('input[value="text"]').click();
        expect(other.querySelector('input[value="diagram"]').checked).toBe(true);
        for (const link of document.querySelectorAll("a")) {
            expect(link.closest(".rs-codelens-memory").contains(document.getElementById(link.hash.slice(1)))).toBe(true);
        }
    });

    it("shows safe fallback data and missing references without broken links", () => {
        const container = document.getElementById("viewer");
        mountTraceViewer(container, {
            code: "example",
            trace: [{
                line: 1, globals: { missing: ["REF", 99], strange: ["REF", 1] },
                heap: { 1: ["UNKNOWN", "<img src=x onerror=alert(1)>"] },
            }],
        });
        expect(container.textContent).toContain("Reference to object 99 (not present in this snapshot)");
        expect(container.querySelectorAll("a")).toHaveLength(1);
        expect(container.querySelector(".rs-codelens-memory__raw").textContent).toContain("<img");
        expect(container.querySelectorAll("img")).toHaveLength(0);
    });

    it("preserves distinct recursive frames and links enclosing scopes to the right frame", () => {
        const container = document.getElementById("viewer");
        const frame = (id, active, parents = []) => ({
            frame_id: id, func_name: "visit", is_highlighted: active,
            is_zombie: !active, parent_frame_id_list: parents,
            encoded_locals: { n: id }, ordered_varnames: ["n"],
        });
        const snapshot = {
            line: 1, stack_to_render: [frame(1, false), frame(2, true, [1])],
            heap: { 1: ["FUNCTION", "inner()", 1] },
        };
        const viewer = mountTraceViewer(container, { code: "visit()", trace: [snapshot, snapshot] });
        const frames = [...container.querySelectorAll("h5")].filter((heading) => heading.textContent.includes("visit — frame"));
        expect(frames.map((heading) => heading.textContent)).toEqual(["visit — frame 1", "visit — frame 2"]);
        expect(frames[0].parentElement.textContent).toContain("Retained frame (returned)");
        expect(frames[1].parentElement.textContent).toContain("Active frame");
        const links = [...container.querySelectorAll("a")].filter((link) => link.textContent === "Enclosing frame 1");
        expect(links).toHaveLength(2);
        expect(links.map((link) => link.hash.slice(1))).toEqual([frames[0].id, frames[0].id]);
        links[1].click();
        expect(document.activeElement).toBe(frames[0]);
        viewer.stepForward();
        expect(document.activeElement.id).toBe(frames[0].id);
    });

    it("disposes an old viewer when remounting the same container", () => {
        const container = document.getElementById("viewer");
        const old = mountTraceViewer(container, graph);
        const replacement = mountTraceViewer(container, hello);
        expect(old.element.isConnected).toBe(false);
        expect(old.stepForward()).toBe(false);
        old.destroy();
        expect(replacement.element.isConnected).toBe(true);
        expect(replacement.stepForward()).toBe(true);
    });

    it("switches viewer layouts without remounting content or changing the step and memory view", () => {
        const container = document.getElementById("viewer");
        const viewer = mountTraceViewer(container, graph);
        const other = mountTraceViewer(document.getElementById("other"), hello);
        const layout = container.querySelector(".rs-codelens-prototype__layout-control select");
        const source = container.querySelector(".rs-codelens-prototype__code");
        const memory = container.querySelector(".rs-codelens-memory");
        expect(viewer.element.dataset.layout).toBe("auto");
        expect([...layout.options].map((option) => option.textContent)).toEqual([
            "Automatic", "Side by side", "Above/below",
        ]);
        container.querySelector('input[value="text"]').click();
        viewer.stepForward();
        layout.focus();
        for (const mode of ["side-by-side", "stacked", "auto"]) {
            layout.value = mode;
            layout.dispatchEvent(new Event("change"));
            expect(document.activeElement).toBe(layout);
            expect(viewer.currentStep).toBe(7);
            expect(container.querySelector(".rs-codelens-prototype__code")).toBe(source);
            expect(container.querySelector(".rs-codelens-memory")).toBe(memory);
            expect(container.querySelector('input[value="text"]').checked).toBe(true);
        }
        layout.value = "stacked";
        layout.dispatchEvent(new Event("change"));
        viewer.stepBackward();
        expect(viewer.element.dataset.layout).toBe("stacked");
        expect(other.element.dataset.layout).toBe("auto");
    });
});
