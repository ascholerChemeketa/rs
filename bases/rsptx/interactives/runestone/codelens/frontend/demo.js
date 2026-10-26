import { mountTraceViewer } from "./trace-viewer.js?v=2";

const traceSelect = document.getElementById("trace");
const themeToggle = document.getElementById("dark-theme");
const viewer = document.getElementById("viewer");
const error = document.getElementById("error");
const traceNote = document.getElementById("trace-note");
let currentViewer = null;
let traceRequest = 0;

async function loadTrace() {
    const request = ++traceRequest;
    const selected = traceSelect.selectedOptions[0];
    const language = selected.dataset.lang ?? "py3";
    error.hidden = true;
    try {
        const response = await fetch(`./fixtures/${selected.value}.json`);
        if (!response.ok) throw new Error(`Trace request failed (${response.status})`);
        const trace = await response.json();
        if (request !== traceRequest) return;
        currentViewer?.destroy();
        currentViewer = mountTraceViewer(viewer, trace, { lang: language });
        traceNote.hidden = language.startsWith("py");
    } catch (failure) {
        if (request !== traceRequest) return;
        currentViewer?.destroy();
        currentViewer = null;
        viewer.replaceChildren();
        traceNote.hidden = true;
        error.textContent = `Could not load the trace: ${failure.message}`;
        error.hidden = false;
    }
}

traceSelect.addEventListener("change", loadTrace);
themeToggle.addEventListener("change", () => {
    document.documentElement.dataset.theme = themeToggle.checked ? "dark" : "light";
});
loadTrace();
