// Checkpoint questions hold forward steps until answered or skipped.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountTraceViewer } from "../frontend/trace-viewer.js";
import { expectedAnswer } from "../frontend/checkpoints.js";
import hello from "../frontend/fixtures/hello-world.json";
import cppQuestions from "../frontend/fixtures/cpp-questions.json";

let answers;
const record = (event) => answers.push(event.detail);

beforeEach(() => {
    document.body.innerHTML = '<div id="viewer"></div>';
    window.localStorage.clear();
    answers = [];
    window.addEventListener("codelens:answer", record);
});

afterEach(() => {
    window.removeEventListener("codelens:answer", record);
});

function mount(options = {}) {
    const root = document.getElementById("viewer");
    const viewer = mountTraceViewer(root, cppQuestions, { lang: "cpp", ...options });
    const area = root.querySelector(".rs-codelens-checkpoint");
    const parts = {
        root,
        viewer,
        area,
        form: area.querySelector("form"),
        input: area.querySelector("input"),
        check: area.querySelector('button[type="submit"]'),
        skip: area.querySelector('button[type="button"]'),
        feedback: area.querySelector('[role="status"]'),
        status: root.querySelector(".rs-codelens-prototype__status"),
        fwd: root.querySelector('[data-codelens-action="fwd"]'),
        answer(text) {
            parts.input.value = text;
            parts.form.requestSubmit();
        },
    };
    return parts;
}

describe("CodeLens checkpoint questions", () => {
    it("reads literal answers and frame paths from the step after the question", () => {
        expect(expectedAnswer(cppQuestions.trace, 3)).toBe("3");
        expect(expectedAnswer(cppQuestions.trace, 7)).toBe(6);
        expect(expectedAnswer(cppQuestions.trace, 0)).toBeUndefined();
        expect(expectedAnswer([{ question: { correct: "globals.n" } }, { globals: { n: "two" } }], 0)).toBe("two");
    });

    it("adds no question area to a trace without questions", () => {
        const root = document.getElementById("viewer");
        mountTraceViewer(root, hello, { lang: "py3" });
        expect(root.querySelector(".rs-codelens-checkpoint")).toBeNull();
    });

    it("shows a labelled question at its step and announces it with the step", () => {
        const { area, form, input, status, fwd, viewer } = mount();
        expect(area.getAttribute("aria-labelledby")).toBe(area.querySelector("h3").id);
        expect(form.hidden).toBe(true);
        expect(area.querySelector('[role="status"]').textContent).toBe("0 of 4 questions answered.");
        viewer.stepForward();
        viewer.stepForward();
        viewer.stepForward();
        expect(viewer.currentStep).toBe(3);
        expect(form.hidden).toBe(false);
        const label = form.querySelector(`label[for="${input.id}"]`);
        expect(label.textContent).toBe("Line 3: What value will be assigned to y?");
        expect(label.querySelector("code").textContent).toBe("y");
        expect(status.textContent).toContain("Question: What value will be assigned to y? Answer it below to continue.");
        expect(fwd.getAttribute("aria-disabled")).toBe("true");
    });

    it("holds forward moves at an open question and sends focus to the answer", () => {
        const { input, status, fwd, viewer } = mount({ startingInstruction: 3 });
        expect(viewer.stepForward()).toBe(false);
        expect(viewer.currentStep).toBe(3);
        expect(document.activeElement).toBe(input);
        expect(status.textContent).toBe("Answer the question below, or skip it, to continue.");
        fwd.focus();
        fwd.click();
        expect(viewer.currentStep).toBe(3);
        expect(viewer.stepBackward()).toBe(true);
        expect(viewer.currentStep).toBe(2);
    });

    it("stops a long jump at the first open question", () => {
        const { form, viewer } = mount();
        viewer.goToEnd();
        expect(viewer.currentStep).toBe(3);
        expect(form.hidden).toBe(false);
    });

    it("gives authored feedback on a wrong answer and records it without completing", () => {
        const { input, feedback, answer, viewer } = mount({ startingInstruction: 3 });
        answer("2");
        expect(feedback.textContent).toBe("Try again. ++ has precedence over = 0 of 4 questions answered.");
        expect(feedback.querySelectorAll("code")).toHaveLength(2);
        expect(document.activeElement).toBe(input);
        expect(answers).toEqual([{ divid: "viewer", correct: false, percent: 0, answer: "3:2" }]);
        expect(viewer.stepForward()).toBe(false);
    });

    it("asks for an answer before checking an empty one", () => {
        const { feedback, answer } = mount({ startingInstruction: 3 });
        answer("  ");
        expect(feedback.textContent).toBe("Enter an answer. 0 of 4 questions answered.");
        expect(answers).toEqual([]);
    });

    it("releases the step on a correct answer and keeps the answer on return", () => {
        const { input, check, skip, feedback, fwd, answer, viewer } = mount({ startingInstruction: 3 });
        answer(" 3 ");
        expect(feedback.textContent).toBe("Correct. 1 of 4 questions answered.");
        expect(answers).toEqual([{ divid: "viewer", correct: false, percent: 0.25, answer: "3:3" }]);
        expect(document.activeElement).toBe(fwd);
        expect(fwd.getAttribute("aria-disabled")).toBe("false");
        expect(input.readOnly).toBe(true);
        expect(check.hidden).toBe(true);
        expect(skip.hidden).toBe(true);
        expect(viewer.stepForward()).toBe(true);
        viewer.stepBackward();
        expect(input.value).toBe("3");
        expect(viewer.stepForward()).toBe(true);
    });

    it("checks frame values numerically and reports completion with the last answer", () => {
        const { answer, viewer } = mount({ startingInstruction: 3 });
        answer("3");
        viewer.goToEnd();
        expect(viewer.currentStep).toBe(7);
        answer("6.0");
        viewer.goToEnd();
        answer("12");
        viewer.goToEnd();
        answer("24");
        expect(viewer.goToEnd()).toBe(true);
        expect(viewer.currentStep).toBe(cppQuestions.trace.length - 1);
        expect(answers.map(({ correct, percent }) => [correct, percent])).toEqual([
            [false, 0.25], [false, 0.5], [false, 0.75], [true, 1],
        ]);
    });

    it("lets a skipped question pass and lists it until answered", () => {
        const { input, check, skip, feedback, fwd, answer, viewer } = mount({ startingInstruction: 3 });
        skip.click();
        expect(feedback.textContent).toBe("Skipped. 0 of 4 questions answered. Skipped question at step 4.");
        expect(document.activeElement).toBe(fwd);
        expect(skip.hidden).toBe(true);
        expect(check.hidden).toBe(false);
        expect(answers).toEqual([]);
        expect(viewer.stepForward()).toBe(true);
        viewer.stepBackward();
        expect(input.readOnly).toBe(false);
        answer("3");
        expect(feedback.textContent).toBe("Correct. 1 of 4 questions answered.");
    });
});
