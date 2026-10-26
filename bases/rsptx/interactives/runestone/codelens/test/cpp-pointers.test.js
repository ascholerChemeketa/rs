import { beforeEach, describe, expect, it } from "vitest";
import { mountTraceViewer } from "../frontend/trace-viewer.js";

const data = (address, type, value) => ["C_DATA", address, type, value];

beforeEach(() => {
    document.body.innerHTML = '<div id="viewer"></div><div id="other"></div>';
});

describe("C++ pointer links", () => {
    it("links stack variables, pointers, and interior fields without losing address text", () => {
        const root = document.getElementById("viewer");
        const snapshot = { globals: {
            // Forward references must resolve even before their target row renders.
            p: data("0x30", "pointer", "0x00020"),
            pp: data("0x34", "pointer", "0x30"),
            field: data("0x38", "pointer", "0x44"),
            owner: data("0x3C", "pointer", "0x40"),
            x: data("0x20", "int", 7),
            holder: ["C_STRUCT", "0x40", "Pair",
                ["first", data("0x40", "int", 8)], ["second", data("0x44", "int", 9)]],
        }, heap: { "0x100": ["C_ARRAY", "0x100", data("0x100", "pointer", "0x30")] } };
        const original = JSON.stringify(snapshot);
        const viewer = mountTraceViewer(root, { code: "example", trace: [snapshot] }, { lang: "cpp" });
        const hash = window.location.hash;
        for (const mode of ["diagram", "graphical", "text"]) {
            root.querySelector(`input[value="${mode}"]`).click();
            for (const [address, name] of [["0x00020", "x"], ["0x30", "p"], ["0x44", "second"], ["0x40", "holder"]]) {
                const links = [...root.querySelectorAll("a")].filter((link) => link.textContent === address);
                expect(links.length).toBeGreaterThan(0);
                for (const link of links) {
                    const target = document.getElementById(link.hash.slice(1));
                    expect(target.firstChild.textContent).toBe(name);
                    expect(link.getAttribute("aria-label")).toContain(`Reference to ${name}`);
                    link.focus();
                    expect(target.classList.contains("rs-codelens-memory__target--referenced")).toBe(true);
                    link.click();
                    expect(document.activeElement).toBe(target);
                    expect(window.location.hash).toBe(hash);
                }
            }
        }
        expect(JSON.stringify(snapshot)).toBe(original);
        viewer.destroy();
    });

    it("resolves heap aliases and interior array elements with case-insensitive, exact addresses", () => {
        const root = document.getElementById("viewer");
        const trace = [{ globals: {
            a: data("0x10", "pointer", "0xa0"),
            alias: data("0x18", "pointer", "0X000A0"),
            element: data("0x20", "pointer", "0xA4"),
        }, heap: { "0xA0": ["C_ARRAY", "0xA0", data("0xA0", "int", 1), data("0xA4", "int", 2)] } }];
        const first = mountTraceViewer(root, { code: "example", trace }, { lang: "cpp" });
        const second = mountTraceViewer(document.getElementById("other"), { code: "example", trace }, { lang: "cpp" });
        const links = root.querySelectorAll("a");
        expect(links[0].hash).toBe(links[1].hash);
        expect(document.getElementById(links[0].hash.slice(1)).textContent).toBe("Array 0xA0");
        expect(document.getElementById(links[2].hash.slice(1)).firstChild.textContent).toBe("1");
        for (const container of [root, document.getElementById("other")]) {
            for (const link of container.querySelectorAll("a")) {
                expect(container.contains(document.getElementById(link.hash.slice(1)))).toBe(true);
            }
        }
        const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
        first.destroy();
        second.destroy();
    });

    it("removes dangling links after deallocation and restores them on earlier steps", () => {
        const root = document.getElementById("viewer");
        const globals = {
            p: data("0x10", "pointer", "0x50"),
            nullPointer: data("0x18", "pointer", "0x0"),
            uninitialized: data("0x20", "pointer", "<UNINITIALIZED>"),
        };
        const viewer = mountTraceViewer(root, { code: "example", trace: [
            { globals, heap: { "0x50": ["C_ARRAY", "0x50", data("0x50", "int", 5)] } },
            { globals, heap: {} },
        ] }, { lang: "cpp" });
        expect(root.querySelectorAll("a")).toHaveLength(1);
        expect(root.textContent).toContain("Null pointer");
        viewer.stepForward();
        expect(root.querySelectorAll("a")).toHaveLength(0);
        expect(root.textContent).toContain("Target not present in this snapshot");
        viewer.stepBackward();
        expect(root.querySelectorAll("a")).toHaveLength(1);
        expect(root.textContent).not.toContain("Target not present in this snapshot");
        viewer.destroy();
    });
});
