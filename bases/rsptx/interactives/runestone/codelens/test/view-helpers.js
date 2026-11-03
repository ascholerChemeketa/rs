// Memory view is a select; tests change it as a person would.
export const viewSelect = (root) => root.querySelector(".rs-codelens-memory__view-controls select");
export function chooseView(root, mode) {
    const select = viewSelect(root);
    select.value = mode;
    select.dispatchEvent(new Event("change"));
}
