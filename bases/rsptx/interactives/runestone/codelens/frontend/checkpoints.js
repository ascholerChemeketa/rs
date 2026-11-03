// Checkpoints are trace steps that carry a question. Stepping forward stops at
// an unanswered checkpoint until its question is answered or skipped. Memory
// stays open for inspection meanwhile, so the question sits below the viewer
// rather than in a dialog.
import { t } from "../../common/js/rsi18n.js";
import "./frontend-i18n.en.js";

function element(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
}

// Question text and feedback are authored HTML (inline code, mostly) from the
// book source, the same trust as the page around the viewer.
function authored(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html ?? "");
    return template.content;
}

/**
 * The answer a checkpoint expects, read from the step after the question:
 * either the literal `correctText`, or the value at a path such as
 * `current_frame.x` (the innermost frame's locals) or `globals.total`.
 * C and C++ encode values as arrays whose last item is the value itself.
 * Returns undefined when the trace does not say.
 */
export function expectedAnswer(trace, index) {
    const question = trace[index]?.question;
    if (!question) return undefined;
    if (question.correctText !== undefined) return String(question.correctText).trim();
    if (typeof question.correct !== "string") return undefined;
    const path = question.correct.split(".");
    let value = trace[index + 1];
    if (path[0] === "current_frame") {
        value = value?.stack_to_render?.at(-1)?.encoded_locals;
        path.shift();
    }
    for (const key of path) value = value?.[key];
    return Array.isArray(value) ? value.at(-1) : value;
}

function matches(answer, expected) {
    if (answer === "") return false;
    if (expected === undefined) return true;
    return typeof expected === "number" ? Number(answer) === expected : answer === String(expected);
}

/**
 * Track and ask a trace's checkpoint questions. `onAnswer` receives each
 * submitted answer in the shape of the codelens:answer event detail;
 * `onSettled` runs once a question no longer blocks stepping forward.
 */
export function createCheckpoints({ trace, prefix, onAnswer = () => {}, onSettled = () => {} }) {
    const indexes = trace.flatMap((entry, index) => (entry.question ? [index] : []));
    // Each checkpoint is "open", "skipped" or "correct".
    const states = new Map(indexes.map((index) => [index, "open"]));
    const answers = new Map();
    let current = null;

    const root = element("section", "rs-codelens-checkpoint");
    const heading = element("h3", null, t("cl_question"));
    heading.id = `${prefix}-question-heading`;
    root.setAttribute("aria-labelledby", heading.id);
    const form = element("form", "rs-codelens-checkpoint__form");
    form.hidden = true;
    const prompt = element("label", "rs-codelens-checkpoint__prompt");
    const input = element("input");
    input.type = "text";
    input.id = `${prefix}-answer`;
    input.autocomplete = "off";
    input.spellcheck = false;
    prompt.htmlFor = input.id;
    const check = element("button", null, t("cl_answer_check"));
    check.type = "submit";
    const skip = element("button", null, t("cl_answer_skip"));
    skip.type = "button";
    const answerRow = element("div", "rs-codelens-checkpoint__answer");
    answerRow.append(input, check, skip);
    form.append(prompt, answerRow);
    const feedback = element("p", "rs-codelens-checkpoint__feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("aria-atomic", "true");
    root.append(heading, form, feedback);
    showFeedback();

    function correctCount() {
        return [...states.values()].filter((state) => state === "correct").length;
    }

    function showFeedback(message = null) {
        const skipped = indexes.filter((index) => states.get(index) === "skipped").map((index) => index + 1);
        let summary = t("cl_questions_progress", correctCount(), indexes.length);
        if (skipped.length > 0) {
            summary += ` ${t(skipped.length === 1 ? "cl_skipped_one" : "cl_skipped_many", skipped.join(", "))}`;
        }
        const lines = [element("span", null, summary)];
        if (message) {
            const first = element("span");
            first.append(message);
            lines.unshift(first, " ");
        }
        feedback.replaceChildren(...lines);
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (current === null || states.get(current) === "correct") return;
        const answer = input.value.trim();
        if (answer === "") {
            showFeedback(t("cl_answer_empty"));
            input.focus();
            return;
        }
        const correct = matches(answer, expectedAnswer(trace, current));
        if (correct) {
            states.set(current, "correct");
            answers.set(current, answer);
        }
        const count = correctCount();
        onAnswer({
            correct: count === indexes.length,
            percent: count / indexes.length,
            answer: `${current}:${answer}`,
        });
        if (correct) {
            showFeedback(t("cl_answer_correct"));
            show(current);
            onSettled();
        } else {
            const message = document.createDocumentFragment();
            message.append(t("cl_answer_try_again"));
            if (trace[current].question.feedback) {
                message.append(" ", authored(trace[current].question.feedback));
            }
            showFeedback(message);
            input.focus();
            input.select();
        }
    });

    skip.addEventListener("click", () => {
        if (current === null || states.get(current) !== "open") return;
        states.set(current, "skipped");
        showFeedback(t("cl_answer_skipped"));
        show(current);
        onSettled();
    });

    /** Show the question for a step, or hide the form when it has none. */
    function show(index) {
        const changed = index !== current;
        current = states.has(index) ? index : null;
        form.hidden = current === null;
        if (current === null) return;
        const state = states.get(current);
        if (changed) {
            prompt.replaceChildren(
                `${t("cl_question_line", trace[current].line)} `,
                authored(trace[current].question.text),
            );
            input.value = answers.get(current) ?? "";
        }
        input.readOnly = state === "correct";
        check.hidden = state === "correct";
        skip.hidden = state !== "open";
    }

    return {
        element: indexes.length > 0 ? root : null,
        /** True when the question at `index` must be settled before moving on. */
        blocks(index) {
            return states.get(index) === "open";
        },
        /** The first checkpoint at or after `from` and before `to` that blocks. */
        firstBlocking(from, to) {
            return indexes.find((index) => index >= from && index < to && states.get(index) === "open") ?? null;
        },
        /** The question's text, for announcing it with the step. */
        promptText(index) {
            return states.has(index) ? authored(trace[index].question.text).textContent.trim() : "";
        },
        show,
        focus() {
            input.focus();
        },
    };
}
