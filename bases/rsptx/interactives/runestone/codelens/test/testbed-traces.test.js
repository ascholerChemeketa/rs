// Real Java and C++ traces should remain navigable before their full adapters exist.
import { describe, expect, it } from "vitest";
import { mountTraceViewer } from "../frontend/trace-viewer.js";
import { normalizeMemory } from "../frontend/memory-model.js";
import javaHello from "../frontend/fixtures/java-hello-world.json";
import javaSieve from "../frontend/fixtures/java-sieve.json";
import cppSieve from "../frontend/fixtures/cpp-sieve.json";
import cppPointers from "../frontend/fixtures/cpp-class-pointers.json";
import cppPassingPointers from "../frontend/fixtures/cpp-passing-pointers.json";
import cppReferencesFunctions from "../frontend/fixtures/cpp-references-functions.json";

describe("Java and C++ testbed samples", () => {
    it.each([
        ["primitive", cppPassingPointers, "int at 0x5C22040"],
        ["struct", cppPointers, "Computer at 0x5C1E040"],
    ])("hides the heap array wrapper around a single %s in all memory views", (_kind, data, label) => {
        document.body.innerHTML = '<div id="viewer"></div>';
        const root = document.getElementById("viewer");
        const startingInstruction = data.trace.findIndex((step) => Object.keys(step.heap).length > 0);
        const viewer = mountTraceViewer(root, data, { lang: "cpp", startingInstruction });
        for (const mode of ["diagram", "graphical", "text"]) {
            root.querySelector(`input[value="${mode}"]`).click();
            const card = root.querySelector("[data-heap-id]");
            expect(card.querySelector("h5").textContent).toBe(label);
            expect(card.textContent).not.toContain("Array");
            expect(card.textContent).not.toContain("Index");
            if (_kind === "struct") {
                expect(card.querySelector('th[scope="row"]').firstChild.textContent).toBe("processorspeed");
                expect(card.querySelectorAll("table")).toHaveLength(1);
                expect(card.style.getPropertyValue("--cl-card-width")).toBe("26rem");
            } else {
                expect(card.querySelectorAll('th[scope="row"]')).toHaveLength(0);
                expect(card.querySelector("td").textContent).toBe("5");
                expect(card.textContent).not.toContain("Address:");
                expect(card.textContent).not.toContain("Type:");
            }
        }
        viewer.destroy();
    });

    it("puts a C++ pointer's address and type under its name and only its value in the value cell", () => {
        document.body.innerHTML = '<div id="viewer"></div>';
        const root = document.getElementById("viewer");
        const startingInstruction = cppPassingPointers.trace.findIndex((step) =>
            step.stack_to_render.some((frame) => frame.encoded_locals.p1?.[3] === "0x5C22040"),
        );
        const viewer = mountTraceViewer(root, cppPassingPointers, { lang: "cpp", startingInstruction });
        const header = [...root.querySelectorAll('th[scope="row"]')].find((cell) =>
            cell.firstChild.textContent === "p1",
        );
        expect(header.textContent).toContain("Address: 0xFFF000B98");
        expect(header.textContent).toContain("Type: pointer");
        expect(header.nextElementSibling.textContent).toBe("0x5C22040");
        const link = header.nextElementSibling.querySelector("a");
        expect(link.textContent).toBe("0x5C22040");
        const target = document.getElementById(link.hash.slice(1));
        expect(target.textContent).toBe("int at 0x5C22040");
        link.click();
        expect(document.activeElement).toBe(target);
        expect(root.textContent).not.toContain("Unsupported value: [\"C_DATA\"");
        expect(root.textContent).not.toContain("Unsupported object encoding");
        viewer.destroy();
    });

    it.each([
        ["Java Hello World", "java", javaHello],
        ["Java Sieve", "java", javaSieve],
        ["C++ Sieve", "cpp", cppSieve],
        ["C++ classes and pointers", "cpp", cppPointers],
        ["C++ passing pointers", "cpp", cppPassingPointers],
        ["C++ references and functions", "cpp", cppReferencesFunctions],
    ])("steps through every snapshot in %s without modifying the trace", (_name, lang, data) => {
        document.body.innerHTML = '<div id="viewer"></div>';
        const root = document.getElementById("viewer");
        const original = JSON.stringify(data);
        const viewer = mountTraceViewer(root, data, { lang });
        for (let index = viewer.currentStep; index < data.trace.length - 1; index++) {
            expect(viewer.stepForward()).toBe(true);
        }
        expect(viewer.currentStep).toBe(data.trace.length - 1);
        expect(viewer.stepForward()).toBe(false);
        expect(root.querySelector(".rs-codelens-prototype__output").textContent).toBe(
            data.trace.at(-1).stdout ?? "",
        );
        expect(viewer.stepBackward()).toBe(true);
        expect(JSON.stringify(data)).toBe(original);
        viewer.destroy();
    });

    it("uses Java boolean spelling in the Sieve array", () => {
        const entry = javaSieve.trace.find((step) => Object.values(step.heap).some((value) => value[0] === "LIST"));
        const memory = normalizeMemory(entry, "java");
        const array = [...memory.objects.values()].find((object) => object.tag === "LIST");
        expect(array.entries).toHaveLength(20);
        expect(array.entries.every((row) => row.value.text === "false")).toBe(true);
    });

    it("decodes structs inside C++ array objects", () => {
        const entry = cppPointers.trace.find((step) => Object.keys(step.heap).length > 0);
        const memory = normalizeMemory(entry, "cpp");
        const struct = [...memory.objects.values()].flatMap((object) => object.entries)
            .find((row) => row.value.kind === "struct").value;
        expect(struct.type).toBe("Computer");
        expect(struct.fields[0].name).toBe("processorspeed");
        expect(struct.fields[0].value.type).toBe("int");
    });
});
