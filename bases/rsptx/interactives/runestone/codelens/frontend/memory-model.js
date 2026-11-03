// Python Tutor snapshots are a graph. Decode values without expanding references,
// so aliases and cycles retain their identity and never recurse through the heap.
import { t } from "../../common/js/rsi18n.js";
import "./frontend-i18n.en.js";

export const memoryKey = (...parts) => JSON.stringify(parts);

function literal(text) {
    return { kind: "literal", text: String(text) };
}

export function cAddress(address) {
    return typeof address === "string" && /^0x[0-9a-f]+$/i.test(address)
        ? `0x${BigInt(address).toString(16)}` : null;
}

export function normalizeValue(value, language = "py3") {
    if (Array.isArray(value)) {
        if (value[0] === "C_STRUCT" && value.length >= 3 &&
            value.slice(3).every((field) => Array.isArray(field) && field.length === 2)) {
            return {
                kind: "struct", address: String(value[1]), type: String(value[2]),
                fields: value.slice(3).map(([name, field]) => ({
                    name: String(name), value: normalizeValue(field, language),
                })),
            };
        }
        if (value[0] === "C_ARRAY" && value.length >= 2) {
            return {
                kind: "array", address: String(value[1]), type: t("cl_array_type"),
                fields: value.slice(2).map((field, index) => ({
                    name: String(index), value: normalizeValue(field, language),
                })),
            };
        }
        if (value[0] === "C_DATA" && value.length === 4) {
            const decoded = typeof value[3] === "string"
                ? literal(value[3]) : normalizeValue(value[3], language);
            const target = value[2] === "pointer"
                ? (value[3] === 0 ? "0x0" : cAddress(value[3])) : null;
            if (target !== null) Object.assign(decoded, { kind: "pointer", id: target });
            return { ...decoded, address: String(value[1]), type: String(value[2]) };
        }
        if (value[0] === "CPP_STRING") {
            return { kind: "string", address: String(value[1]), type: "string", chars: value[2] };
        }
        if (value[0] === "REF") return { kind: "reference", id: String(value[1]) };
        if (["SPECIAL_FLOAT", "IMPORTED_FAUX_PRIMITIVE"].includes(value[0])) {
            return literal(value[1]);
        }
        return literal(t("cl_unknown_value", JSON.stringify(value)));
    }
    const python = language.startsWith("py");
    if (value === null) return literal(python ? "None" : "null");
    if (typeof value === "boolean") {
        return literal(python ? (value ? "True" : "False") : String(value));
    }
    if (typeof value === "string") return literal(JSON.stringify(value));
    if (typeof value === "number") return literal(value);
    return literal(t("cl_unknown_value", JSON.stringify(value)));
}

export function aggregateRows(value, parentKey) {
    return value.fields.map((field) => ({
        ...field,
        key: memoryKey(parentKey, "field", field.name),
        location: value.kind === "array" ? t("cl_index_location", field.name) : field.name,
    }));
}

// Java reports a void method's return as ["VOID"]; there is no value to show.
const isVoidReturn = (name, value) => name === "__return__" && Array.isArray(value) && value[0] === "VOID";

function bindings(values = {}, order = [], prefix, language) {
    const names = [...new Set([...order, ...Object.keys(values)])];
    return names
        .filter((name) => Object.prototype.hasOwnProperty.call(values, name))
        .filter((name) => !isVoidReturn(name, values[name]))
        .map((name) => ({
            key: memoryKey(...prefix, name),
            name: name === "__return__" ? t("cl_return") : name,
            value: normalizeValue(values[name], language),
        }));
}

function normalizeObject(id, raw, language) {
    const tag = Array.isArray(raw) ? raw[0] : "?";
    const object = {
        id,
        key: memoryKey("heap", id),
        tag,
        label: t("cl_object", id, tag),
        keyHeading: t("cl_name"),
        entries: [],
    };
    function row(key, value, identity = key) {
        object.entries.push({
            key: memoryKey("heap", id, identity),
            name: normalizeValue(key, language),
            value: normalizeValue(value, language),
        });
    }
    function namedRow(name, value) {
        row(name, value);
        object.entries[object.entries.length - 1].name = literal(name);
    }
    function pairs(items, named = false) {
        for (const pair of items) {
            if (!Array.isArray(pair) || pair.length !== 2) return false;
            if (named && typeof pair[0] === "string") namedRow(pair[0], pair[1]);
            else row(pair[0], pair[1]);
        }
        return true;
    }

    let supported = Array.isArray(raw);
    switch (tag) {
        case "C_STRUCT": {
            const value = normalizeValue(raw, language);
            supported = value.kind === "struct";
            if (supported) {
                object.label = t("cl_c_struct", value.type, value.address);
                object.keyHeading = t("cl_field");
                object.entries = aggregateRows(value, object.key);
            }
            break;
        }
        case "C_DATA":
            namedRow(t("cl_value"), raw);
            break;
        case "C_ARRAY":
            object.label = t("cl_c_array", id);
            object.keyHeading = t("cl_index");
            raw.slice(2).forEach((value, index) => row(index, value));
            if (object.entries.length === 1) {
                const entry = object.entries[0];
                object.singleElement = true;
                object.label = entry.value.type !== undefined
                    ? t("cl_aggregate_value", entry.value.type, entry.value.address ?? raw[1])
                    : t("cl_memory_chunk", raw[1]);
                entry.name = literal(t("cl_value"));
            }
            break;
        case "LIST":
        case "TUPLE":
        case "SET":
            object.label = t(`cl_${tag.toLowerCase()}`, id);
            object.keyHeading = t(tag === "SET" ? "cl_member" : "cl_index");
            raw.slice(1).forEach((value, index) => {
                const set = tag === "SET";
                row(set ? index + 1 : index, value, set ? ["member", value] : index);
                object.entries[object.entries.length - 1].location = t(
                    set ? "cl_member_location" : "cl_index_location",
                    set ? index + 1 : index,
                );
            });
            break;
        case "DICT":
            object.label = t("cl_dict", id);
            object.keyHeading = t("cl_key");
            supported = pairs(raw.slice(1));
            break;
        case "INSTANCE":
        case "INSTANCE_PPRINT":
        case "CLASS": {
            object.label = t(tag === "CLASS" ? "cl_class" : "cl_instance", raw[1], id);
            object.keyHeading = t("cl_attribute");
            const start = tag === "INSTANCE" ? 2 : 3;
            if (tag === "INSTANCE_PPRINT") namedRow(t("cl_representation"), raw[2]);
            if (tag === "CLASS") namedRow(t("cl_bases"), (raw[2] ?? []).join(", "));
            supported = pairs(raw.slice(start), true);
            break;
        }
        case "FUNCTION":
            object.label = t("cl_function", id);
            namedRow(t("cl_signature"), raw[1]);
            // Scope is a frame relationship, not a heap reference.
            object.enclosingFrame = raw[2] === null ? null : String(raw[2]);
            for (const [name, value] of raw[3] ?? []) {
                namedRow(t("cl_default", name), value);
            }
            break;
        case "HEAP_PRIMITIVE":
            object.label = t("cl_primitive", raw[1], id);
            namedRow(t("cl_value"), raw[2]);
            break;
        default:
            supported = false;
    }
    if (!supported) {
        object.entries = [];
        object.unsupported = t("cl_unknown_object", JSON.stringify(raw));
    }
    return object;
}

// Java names every constructor <init>. In simple programs the nearest class
// declaration above the constructor's current line names its class.
function javaConstructorClass(code, line) {
    const lines = code.split("\n");
    for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
        const match = /\b(?:class|record|enum)\s+([A-Za-z_$][\w$]*)/.exec(lines[index]);
        if (match) return match[1];
    }
    return null;
}

function forEachReference(value, visit) {
    if (!Array.isArray(value)) return;
    if (value[0] === "REF" && value.length === 2) visit(String(value[1]));
    else for (const item of value) forEachReference(item, visit);
}

/**
 * Python functions that are only ever reached through their own global name,
 * across the whole trace. These read as values, so they need no heap card.
 * A function stays on the heap when it is nested, has defaults, or is passed,
 * stored, or aliased anywhere in the run.
 */
export function findInlineFunctions(trace, language = "py3") {
    const inline = new Map();
    if (!language.startsWith("py")) return inline;
    const rejected = new Set();
    for (const entry of trace) {
        for (const [id, raw] of Object.entries(entry.heap ?? {})) {
            if (raw[0] !== "FUNCTION") continue;
            if (raw[2] !== null || (raw[3] ?? []).length > 0) rejected.add(id);
            else inline.set(id, String(raw[1]));
        }
    }
    for (const entry of trace) {
        for (const [name, value] of Object.entries(entry.globals ?? {})) {
            forEachReference(value, (id) => {
                if (!inline.has(id)) return;
                const own = value[0] === "REF" && inline.get(id).split("(")[0] === name;
                if (!own) rejected.add(id);
            });
        }
        const elsewhere = [
            ...(entry.stack_to_render ?? []).map((frame) => frame.encoded_locals),
            ...Object.values(entry.heap ?? {}),
        ];
        forEachReference(elsewhere.map((values) => Object.values(values ?? {})), (id) => rejected.add(id));
    }
    for (const id of rejected) inline.delete(id);
    return inline;
}

// libstdc++ keeps a std::string's characters in a heap char buffer reached
// through _M_dataplus._M_p. Returns that pointer's address, or null.
function cppStringPointer(raw) {
    if (!Array.isArray(raw) || raw[0] !== "C_STRUCT" ||
        !/^(?:std::)?(?:string|basic_string<char\b.*)$/.test(String(raw[2]))) return null;
    const field = (struct, name) => struct?.[0] === "C_STRUCT"
        ? struct.slice(3).find((item) => Array.isArray(item) && item[0] === name)?.[1] : undefined;
    const pointer = field(field(raw, "_M_dataplus"), "_M_p");
    return pointer?.[0] === "C_DATA" && pointer[2] === "pointer" ? cAddress(pointer[3]) : null;
}

function forEachValue(entry, visit) {
    const walk = (value) => {
        if (!Array.isArray(value)) return;
        visit(value);
        for (const item of value) walk(item);
    };
    for (const value of Object.values(entry.globals ?? {})) walk(value);
    for (const frame of entry.stack_to_render ?? []) {
        for (const value of Object.values(frame.encoded_locals ?? {})) walk(value);
    }
    for (const value of Object.values(entry.heap ?? {})) walk(value);
}

export function hasCppStrings(trace) {
    return trace.some((entry) => {
        let found = false;
        forEachValue(entry, (value) => { found ||= cppStringPointer(value) !== null; });
        return found;
    });
}

/**
 * Replace each C++ string struct in a snapshot with its characters, read from
 * the heap buffer it points to. Returns the rewritten snapshot and the ids of
 * the heap arrays that only held string text.
 */
export function simplifyCppStrings(entry) {
    const chars = new Map();
    for (const [id, raw] of Object.entries(entry.heap ?? {})) {
        if (raw[0] !== "C_ARRAY") continue;
        for (const item of raw.slice(2)) {
            const address = Array.isArray(item) && item[0] === "C_DATA" && item[2] === "char" && cAddress(item[1]);
            if (address) chars.set(address, { id, text: item[3] });
        }
    }
    const buffers = new Set();
    const read = (address) => {
        const text = [];
        for (let next = BigInt(address); ; next++) {
            const item = chars.get(`0x${next.toString(16)}`);
            if (!item) return null;
            if (item.text === "\\0") {
                buffers.add(item.id);
                return text;
            }
            if (item.text === "<UNINITIALIZED>") return null;
            text.push(item.text);
        }
    };
    const rewrite = (value) => {
        if (!Array.isArray(value)) return value;
        const pointer = cppStringPointer(value);
        const text = pointer && read(pointer);
        return text ? ["CPP_STRING", value[1], text] : value.map(rewrite);
    };
    const rewriteAll = (values) => values && Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, rewrite(value)]));
    const simplified = {
        ...entry,
        globals: rewriteAll(entry.globals),
        stack_to_render: entry.stack_to_render?.map((frame) => ({
            ...frame, encoded_locals: rewriteAll(frame.encoded_locals),
        })),
        heap: rewriteAll(entry.heap),
    };
    for (const id of buffers) delete simplified.heap[id];
    return { entry: simplified, buffers };
}

export function normalizeMemory(entry, language = "py3", code = "", inlineFunctions = new Map(), { simpleStrings = false } = {}) {
    if (simpleStrings) entry = simplifyCppStrings(entry).entry;
    const inlineValue = (raw) => raw?.[0] === "REF" && inlineFunctions.has(String(raw[1]))
        ? literal(t("cl_function_value", inlineFunctions.get(String(raw[1])))) : null;
    return {
        globals: bindings(entry.globals, entry.ordered_globals, ["global"], language)
            .map((row) => ({ ...row, value: inlineValue(entry.globals[row.name]) ?? row.value })),
        frames: (entry.stack_to_render ?? []).map((frame, index, stack) => {
            // Java traces append the line to the function name and number
            // frames afresh at every step, so identify them by stack depth.
            const java = language === "java";
            const [, name, line] = java
                ? /^(.*?)(?::(\d+))?$/.exec(String(frame.func_name))
                : [null, frame.func_name];
            const id = java
                ? `${stack.length - 1 - index}-${name}`
                : String(frame.frame_id ?? frame.unique_hash ?? index);
            const className = java && name === "<init>" && line ? javaConstructorClass(code, Number(line)) : null;
            let label = t("cl_frame", name, id);
            if (java) label = className ? t("cl_constructor", className) : name;
            return {
                id,
                key: memoryKey("frame", id),
                label,
                active: Boolean(frame.is_highlighted),
                retained: Boolean(frame.is_zombie),
                parents: (frame.parent_frame_id_list ?? []).map(String),
                bindings: bindings(
                    frame.encoded_locals,
                    frame.ordered_varnames,
                    ["frame", id, "local"],
                    language,
                ),
            };
        }),
        objects: new Map(
            Object.entries(entry.heap ?? {})
                .filter(([id]) => !inlineFunctions.has(id))
                .map(([id, raw]) => [id, normalizeObject(id, raw, language)]),
        ),
    };
}

export function valueText(value, memory) {
    if (value.kind === "string") return JSON.stringify(value.chars.join(""));
    if (value.kind === "struct" || value.kind === "array") {
        return t("cl_aggregate_value", value.type, value.address);
    }
    if (value.kind !== "reference") return value.text;
    const target = memory.objects.get(value.id);
    return target
        ? t("cl_reference", target.label)
        : t("cl_missing_reference", value.id);
}

// Diffs operate on snapshot values, never on the DOM or a recursive expansion.
export function memoryChanges(previous, current) {
    if (!previous) return [];
    const changes = [];
    function change(key, text) {
        changes.push({ key, text });
    }
    function compareRows(before, after, scope) {
        const oldRows = new Map(before.map((row) => [row.key, row]));
        const newRows = new Map(after.map((row) => [row.key, row]));
        for (const [key, row] of newRows) {
            const old = oldRows.get(key);
            const name = row.location ?? (
                typeof row.name === "string" ? row.name : valueText(row.name, current)
            );
            const label = t("cl_location", scope, name);
            const value = valueText(row.value, current);
            if (!old) change(key, t("cl_added", label, value));
            else if ((row.value.kind === "struct" || row.value.kind === "array") &&
                old.value.kind === row.value.kind && old.value.address === row.value.address &&
                old.value.type === row.value.type) {
                compareRows(aggregateRows(old.value, key), aggregateRows(row.value, key), label);
            } else if (JSON.stringify(old.value) !== JSON.stringify(row.value)) {
                change(key, t("cl_value_changed", label, valueText(old.value, previous), value));
            }
        }
        for (const [key, row] of oldRows) {
            if (!newRows.has(key)) {
                const name = row.location ?? (
                    typeof row.name === "string" ? row.name : valueText(row.name, previous)
                );
                change(key, t("cl_removed",
                    t("cl_location", scope, name), valueText(row.value, previous),
                ));
            }
        }
    }
    compareRows(previous.globals, current.globals, t("cl_globals"));
    function compareGroups(before, after, rows) {
        const oldGroups = new Map(before.map((group) => [group.key, group]));
        const newGroups = new Map(after.map((group) => [group.key, group]));
        for (const [key, group] of newGroups) {
            const old = oldGroups.get(key);
            if (!old) change(key, t("cl_new_item", group.label));
            else {
                compareRows(rows(old), rows(group), group.label);
                if (old.unsupported !== group.unsupported || old.enclosingFrame !== group.enclosingFrame) {
                    change(key, t("cl_value_changed", group.label,
                        old.unsupported ?? old.enclosingFrame ?? t("cl_global_scope"),
                        group.unsupported ?? group.enclosingFrame ?? t("cl_global_scope")));
                }
            }
        }
        for (const [key, group] of oldGroups) {
            if (!newGroups.has(key)) change(key, t("cl_removed_item", group.label));
        }
    }
    compareGroups(previous.frames, current.frames, (frame) => frame.bindings);
    compareGroups(
        [...previous.objects.values()],
        [...current.objects.values()],
        (object) => object.entries,
    );
    return changes;
}
