// The legacy wrapper still uses jQuery for its slider and login event.
import "../../../test-support/jquery-globals.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import RunestoneBase from "../../common/js/runestonebase.js";
import hello from "../frontend/fixtures/hello-world.json";

beforeAll(async () => {
    await import("../js/codelens.js");
});

beforeEach(() => {
    document.body.innerHTML = `
        <div id="component">
            <div class="pytutorVisualizer" id="trace-one" data-params='{"lang":"py3"}'></div>
        </div>`;
    window.history.replaceState({}, "", "/");
    window.allVisualizers = [];
    globalThis.allTraceData = { "trace-one": hello };
    vi.spyOn(RunestoneBase.prototype, "logBookEvent").mockImplementation(() => {});
});

describe("CodeLens prototype opt-in", () => {
    it("uses the new viewer for a named instance and preserves navigation logging", () => {
        window.history.replaceState({}, "", "/?codelensPrototype=trace-one");
        window.component_factory.codelens({ orig: document.getElementById("component") });

        const root = document.getElementById("trace-one");
        expect(root.querySelector(".rs-codelens-prototype")).toBeTruthy();
        expect(root.classList.contains("runestone-component-ready")).toBe(true);
        root.querySelector("button[data-codelens-action=fwd]").click();
        expect(RunestoneBase.prototype.logBookEvent).toHaveBeenCalledWith(
            expect.objectContaining({ event: "codelens", act: "fwd", div_id: "trace-one" }),
        );
        const previous = root.querySelector('button[data-codelens-action="back"]');
        previous.click();
        expect(RunestoneBase.prototype.logBookEvent).toHaveBeenLastCalledWith(
            expect.objectContaining({ event: "codelens", act: "back", div_id: "trace-one" }),
        );
        const calls = RunestoneBase.prototype.logBookEvent.mock.calls.length;
        previous.click();
        expect(RunestoneBase.prototype.logBookEvent.mock.calls).toHaveLength(calls);
    });

    it("keeps the legacy renderer for a trace with questions", () => {
        window.history.replaceState({}, "", "/?codelensPrototype=trace-one");
        const legacy = vi.fn(() => ({ domRoot: $("#trace-one") }));
        globalThis.addVisualizerToPage = legacy;
        globalThis.allTraceData = {
            "trace-one": {
                ...hello,
                trace: [{ ...hello.trace[0], question: { text: "Question" } }, hello.trace[1]],
            },
        };

        window.component_factory.codelens({ orig: document.getElementById("component") });
        expect(legacy).toHaveBeenCalledOnce();
        expect(document.querySelector(".rs-codelens-prototype")).toBeNull();
    });

    it("also opts in through the login-complete initialization path", () => {
        window.history.replaceState({}, "", "/?codelensPrototype=trace-one");
        $(document).trigger("runestone:login-complete");

        expect(document.querySelector(".rs-codelens-prototype")).toBeTruthy();
        expect(window.allVisualizers).toHaveLength(1);
    });
});
