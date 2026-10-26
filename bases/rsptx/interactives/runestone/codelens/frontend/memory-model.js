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

function bindings(values = {}, order = [], prefix, language) {
    const names = [...new Set([...order, ...Object.keys(values)])];
    return names
        .filter((name) => Object.prototype.hasOwnProperty.call(values, name))
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

export function normalizeMemory(entry, language = "py3") {
    return {
        globals: bindings(entry.globals, entry.ordered_globals, ["global"], language),
        frames: (entry.stack_to_render ?? []).map((frame, index) => {
            const id = String(frame.frame_id ?? frame.unique_hash ?? index);
            return {
                id,
                key: memoryKey("frame", id),
                label: t("cl_frame", frame.func_name, id),
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
            Object.entries(entry.heap ?? {}).map(([id, raw]) => [
                id, normalizeObject(id, raw, language),
            ]),
        ),
    };
}

export function valueText(value, memory) {
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
