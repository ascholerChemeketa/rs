/**
 * Created by bmiller on 5/10/15.
 */

/*
 Since I don't want to modify the codelens code I'll attach the logging functionality this way.
 This actually seems like a better way to do it maybe across the board to separate logging
 from the real funcionality.  It would also allow a better way of turning off/on logging..
 As long as Philip doesn't go and change the id values for the buttons and slider this will
 continue to work.... In the best of all worlds we might add a function to the visualizer to
 return the buttons, but I'm having a hard time thinking of any other use for that besides mine.
 */

import RunestoneBase from "../../common/js/runestonebase.js";
import "./pytutor-embed.bundle.js";
import "./../css/pytutor.css";
import { mountTraceViewer } from "../frontend/trace-viewer.js";
import "../frontend/trace-viewer.css";

function attachLoggers(codelens, divid) {
    let rb = new RunestoneBase();
    const root = document.getElementById(divid);
    for (const [buttonId, action] of [
        ["jmpFirstInstr", "first"],
        ["jmpLastInstr", "last"],
        ["jmpStepBack", "back"],
        ["jmpStepFwd", "fwd"],
    ]) {
        root.querySelector(
            `#${buttonId}, [data-codelens-action="${action}"]`,
        )?.addEventListener("click", () => {
            rb.logBookEvent({ event: "codelens", act: action, div_id: divid });
        });
    }
    // The legacy jQuery UI slider emits a jQuery event rather than a DOM event.
    codelens.domRoot?.find("#executionSlider").bind("slide", function () {
        rb.logBookEvent({ event: "codelens", act: "slide", div_id: divid });
    });
    // TODO: The component isn't quite fully initialized, but it also doesn't inherit from RunestoneBase. This is a convenient place to mark it ready for now, but it should be moved forward in time during a rewrite.
    rb.containerDiv = document.getElementById(divid);
    rb.indicate_component_ready();
}

function styleButtons(divid) {
    const root = document.getElementById(divid);
    for (const [buttonId, buttonClass, action] of [
        ["jmpFirstInstr", "btn-default"],
        ["jmpStepBack", "btn-danger"],
        ["jmpStepFwd", "btn-success", "fwd"],
        ["jmpLastInstr", "btn-default"],
    ]) {
        const selector = action
            ? `#${buttonId}, [data-codelens-action="${action}"]`
            : `#${buttonId}`;
        root.querySelector(selector)?.classList.add("btn", buttonClass);
    }
}

function renderVisualizer(data, divid, lang) {
    const options = {
        startingInstruction: data.startingInstruction || 0,
        editCodeBaseURL: null,
        hideCode: false,
        lang: lang,
    };
    const usePrototype =
        Array.isArray(data.trace) &&
        data.trace.length > 0 &&
        new URLSearchParams(window.location.search).get("codelensPrototype") ===
            divid &&
        !data.trace.some(
            (entry) =>
                entry.question ||
                entry.event === "raw_input" ||
                entry.event === "mouse_input",
        );
    return usePrototype
        ? mountTraceViewer(document.getElementById(divid), data, options)
        : addVisualizerToPage(data, divid, options);
}

if (typeof window.allVisualizers === "undefined") {
    window.allVisualizers = [];
}

if (typeof window.component_factory === "undefined") {
    window.component_factory = {};
}

window.component_factory.codelens = function (opts) {
    // opts is an object that will contain a key referencing the orignal dom element
    // often it will also have a key for  useRunestoneServices
    let el = opts.orig;
    let vel = el.querySelector(".pytutorVisualizer");
    let divid = vel.id;
    let lang = JSON.parse(vel.dataset.params).lang;
    // addVisualizerToPage comes from pytutor-embed
    // allTraceData is created by a series of script tags that when loaded create this
    // as a global object containing trace information.
    try {
        let vis = renderVisualizer(allTraceData[divid], divid, lang);
        attachLoggers(vis, divid);
        styleButtons(divid);
        window.allVisualizers.push(vis);
    } catch (err) {
        console.log(`Error rendering CodeLens Problem ${divid}`);
        console.log(err);
    }

};

window.addEventListener("codelens:answer", function (evt) {
    let rb = new RunestoneBase();
    rb.logBookEvent({
        event: "codelens",
        div_id: evt.detail.divid,
        act: "answer",
        answer: evt.detail.answer,
        correct: evt.detail.correct,
        percent: evt.detail.percent || 0,
    });
    console.log(evt);
});

// After all of the libraries are loaded...
$(document).on("runestone:login-complete", function () {
    if (typeof allTraceData !== "undefined") {
        for (let divid in allTraceData) {
            let cl = document.getElementById(divid);
            if (cl === null) {
                console.log(`Could not find element with id ${divid}`);
                return;
            }
            let lang = JSON.parse(cl.dataset.params).lang;
            try {
                if (divid in window.allTraceData) {
                    var vis = renderVisualizer(allTraceData[divid], divid, lang);
                } else {
                    alert(
                        `${divid} is missing trace data.  This is probably a build error. Please report it on github.`,
                    );
                }
                attachLoggers(vis, divid);
                styleButtons(divid);
                window.allVisualizers.push(vis);
            } catch (err) {
                console.log(`Error rendering CodeLens Problem ${divid}`);
                console.log(err);
            }
        }
    }
});
