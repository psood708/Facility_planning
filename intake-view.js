/* PDF intake — screens. Pure views over the DOM builder h() (the same one the
 * rest of the app uses), so each state renders to plain objects in tests:
 *
 *   uploadPanel(h, { onFile, error })
 *   progress(h, { name, page, pages, source, onCancel })
 *   review(h, { items, fileName, labels, onApply, onDiscard })
 *   summary(h, { fileName, filled, errors, onGo })
 *
 * items come from IntakeMatch.resolve(). Nothing is filled without a tick:
 * only high-confidence new values start ticked, conflicts are an unanswered
 * choice, and values already in the project are only counted. Document text
 * is always a text child, never markup.
 * Browser: window.IntakeView; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.IntakeView = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  let uid = 0;
  const nextId = (p) => `intake-${p}-${++uid}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  // Swap a built node's children: the real DOM in the browser, plain objects in tests.
  const setKids = (node, kids) => {
    if (typeof node.replaceChildren === "function") node.replaceChildren(...kids);
    else node.children = kids;
  };
  const setAttr = (node, k, v) => {
    if (typeof node.setAttribute === "function") node.setAttribute(k, v);
    else node.attrs[k] = v;
  };
  const CONF = { high: ["●●●", "High confidence"], medium: ["●●○", "Medium confidence"], low: ["●○○", "Low confidence"] };
  const FIELD = { category: "Dosage form category", form: "Specific form", devStage: "Development stage", market: "Target market", room: "Add this room" };

  function uploadPanel(h, { onFile, error }) {
    const head = nextId("head");
    const input = nextId("file");
    return h("section", { class: "intake-panel", "aria-labelledby": head }, [
      h("h3", { id: head }, "Fill from a document (optional)"),
      h("p", { class: "intake-lede" }, "Pick a PDF that describes the facility — a room data sheet, specification, scan or layout drawing. It is read on this computer and never uploaded. You review every value before anything is filled."),
      h("div", { class: "field-block" }, [
        h("label", { for: input }, "Choose a PDF"),
        h("input", {
          type: "file", id: input, accept: "application/pdf,.pdf", "aria-describedby": input + "-hint",
          onchange: (e) => { const f = e && e.target && e.target.files && e.target.files[0]; if (f) onFile(f); },
        }),
        h("span", { class: "field-hint", id: input + "-hint" }, "Up to 25 MB. Scanned pages take longer: their text is read with OCR (up to 40 scanned pages)."),
      ]),
      error ? h("p", { class: "field-error intake-error", role: "alert" }, error) : null,
    ]);
  }

  // Built once, then updated in place through node.intakeUpdate(progress), so
  // focus on Cancel survives page changes. The live region speaks only when
  // reading switches to OCR, every 10 pages, and on the last page.
  function progress(h, { name, page, pages, source, onCancel }) {
    const head = nextId("head");
    const words = (p) => `Reading page ${p.page} of ${p.pages}${p.source === "ocr" ? " — scanned, reading the text with OCR" : ""}.`;
    const bar = h("progress", { class: "intake-progress", value: String(page), max: String(pages), "aria-labelledby": head }, `${page} of ${pages}`);
    const visible = h("p", { class: "intake-progress-text" }, words({ page, pages, source }));
    const status = h("p", { class: "sr-only", role: "status" }, source === "ocr" ? words({ page, pages, source }) : "");
    const cancel = h("button", {
      type: "button", class: "secondary",
      onclick: (e) => {
        const b = e && e.currentTarget;
        if (b) { setKids(b, ["Cancelling…"]); setAttr(b, "disabled", "disabled"); }
        if (onCancel) onCancel();
      },
    }, "Cancel");
    const node = h("section", { class: "intake-panel", "aria-labelledby": head, "aria-busy": "true" }, [
      h("h3", { id: head, tabindex: "-1" }, `Reading “${name}”`), bar, visible, status, cancel,
    ]);
    let lastSource = source;
    let lastSpoken = page;
    node.intakeUpdate = (p) => {
      setAttr(bar, "value", String(p.page));
      setAttr(bar, "max", String(p.pages));
      setKids(bar, [`${p.page} of ${p.pages}`]);
      setKids(visible, [words(p)]);
      if (p.source !== lastSource || p.page - lastSpoken >= 10 || p.page === p.pages) {
        setKids(status, [words(p)]);
        lastSpoken = p.page;
      }
      lastSource = p.source;
    };
    return node;
  }

  const fieldName = (t, labels) => (t.kind === "param" ? labels.param(t.paramId) : FIELD[t.kind] || t.kind);
  const conf = (h, level) => h("span", { class: "intake-conf conf-" + level }, [h("span", { "aria-hidden": "true" }, CONF[level][0] + " "), CONF[level][1]]);
  const sourceLine = (h, sources, idBase) => (sources || []).slice(0, 2).map((s, k) => h("p", { class: "intake-source", id: idBase ? `${idBase}-src${k}` : null }, `p.${s.page}: ${s.text}`));

  function review(h, { items, fileName, labels, onApply, onDiscard }) {
    const head = nextId("head");
    const list = Array.isArray(items) ? items : [];
    const notes = list.filter((i) => i.note);
    const same = list.filter((i) => !i.note && i.same);
    const offered = list.filter((i) => !i.note && !i.same);
    if (!offered.length) {
      return h("section", { class: "intake-panel", "aria-labelledby": head }, [
        h("h3", { id: head, tabindex: "-1" }, "Review what was found"),
        h("p", {}, same.length
          ? `Every value found in ${fileName} already matches the project (${plural(same.length, "value")}).`
          : `Nothing in ${fileName} could be matched to the facility's rooms or parameters. Check that it is the right document, or enter the values in Steps 1–3.`),
        notes.length ? h("ul", { class: "intake-notes" }, notes.map((n) => h("li", {}, n.display))) : null,
        h("div", { class: "intake-actions" }, h("button", { type: "button", class: "secondary", onclick: () => onDiscard && onDiscard() }, "Back")),
      ]);
    }

    // Ticks live here; the DOM mirrors them.
    const ticked = new Map(offered.filter((i) => !i.conflict).map((i) => [i.key, !!i.checked]));
    const chosen = new Map(); // conflict key -> option index
    const boxes = new Map();
    const count = () => [...ticked.values()].filter(Boolean).length + chosen.size;
    const applyText = () => `Fill the selected ${plural(count(), "value")}`;
    const applyBtn = h("button", {
      type: "button", class: "primary",
      onclick: () => {
        const accepted = offered.filter((i) => !i.conflict && ticked.get(i.key)).map((i) => ({ target: i.target, value: i.value, key: i.key, sources: i.sources }))
          .concat([...chosen].map(([key, k]) => { const i = offered.find((x) => x.key === key); return { target: i.target, value: i.options[k].value, key, sources: i.options[k].sources }; }));
        onApply(accepted);
      },
    }, applyText());
    const refresh = () => setKids(applyBtn, [applyText()]);

    const row = (i) => {
      if (i.conflict) {
        const name = nextId("choice");
        const opts = i.options.map((o, k) => {
          const id = nextId("opt");
          return h("div", { class: "intake-option" }, [
            h("input", { type: "radio", id, name, value: String(k), onchange: (e) => { if (!e || !e.target || e.target.checked) { chosen.set(i.key, k); refresh(); } } }),
            h("label", { for: id }, [`${o.display} `, conf(h, o.confidence)]),
            ...sourceLine(h, o.sources),
          ]);
        });
        const skip = nextId("opt");
        opts.push(h("div", { class: "intake-option" }, [
          h("input", { type: "radio", id: skip, name, value: "skip", onchange: (e) => { if (!e || !e.target || e.target.checked) { chosen.delete(i.key); refresh(); } } }),
          h("label", { for: skip }, "Don't fill"),
        ]));
        return h("fieldset", { class: "intake-conflict" }, [
          h("legend", {}, `${fieldName(i.target, labels)}: different values found — choose one`),
          i.replaces ? h("p", { class: "intake-meta" }, `Replaces ${i.replaces}`) : null,
          ...opts,
        ]);
      }
      const id = nextId("item");
      const meta = [i.reason, i.converted ? `Converted ${i.converted}` : null, i.replaces ? `Replaces ${i.replaces}` : null].filter(Boolean).join(" · ");
      const sources = sourceLine(h, i.sources, id);
      const described = [meta ? id + "-meta" : null, ...sources.map((s) => s.attrs ? s.attrs.id : s.id)].filter(Boolean).join(" ");
      const box = h("input", {
        type: "checkbox", id, checked: i.checked ? "checked" : null, "aria-describedby": described || null,
        onchange: (e) => { ticked.set(i.key, !!(e && e.target && e.target.checked)); refresh(); },
      });
      boxes.set(i.key, box);
      return h("li", { class: "intake-row" + (i.replaces ? " intake-replaces" : "") }, [
        h("div", { class: "intake-check" }, [box, h("label", { for: id }, [`${fieldName(i.target, labels)}: ${i.display} `, conf(h, i.confidence)])]),
        meta ? h("p", { class: "intake-meta", id: id + "-meta" }, meta) : null,
        ...sources,
      ]);
    };

    // Facility first, then one group per room (in the order resolve() gave).
    const groups = [];
    const facility = offered.filter((i) => !(i.target.roomId));
    if (facility.length) groups.push({ title: "Facility", items: facility });
    const byRoom = new Map();
    offered.filter((i) => i.target.roomId).forEach((i) => {
      if (!byRoom.has(i.target.roomId)) byRoom.set(i.target.roomId, []);
      byRoom.get(i.target.roomId).push(i);
    });
    byRoom.forEach((its, roomId) => groups.push({ title: labels.room(roomId), items: its }));

    const setAll = (fn) => {
      offered.filter((i) => !i.conflict).forEach((i) => {
        const v = fn(i);
        ticked.set(i.key, v);
        const b = boxes.get(i.key);
        if (b) { b.checked = v; if (b.attrs) b.attrs.checked = v ? "checked" : null; }
      });
      refresh();
    };

    return h("section", { class: "intake-panel intake-review", "aria-labelledby": head }, [
      h("h3", { id: head, tabindex: "-1" }, "Review what was found"),
      h("p", { class: "intake-lede" }, `${plural(offered.length, "value")} found in ${fileName}. Only high-confidence values are ticked. Untick anything wrong — you can also change values in Steps 1–3 afterwards.`),
      same.length ? h("p", { class: "intake-meta" }, `${plural(same.length, "value")} already ${same.length === 1 ? "matches" : "match"} the project and ${same.length === 1 ? "is" : "are"} not shown.`) : null,
      notes.length ? h("ul", { class: "intake-notes" }, notes.map((n) => h("li", {}, n.display))) : null,
      h("div", { class: "intake-actions" }, [
        h("button", { type: "button", class: "secondary small", onclick: () => setAll((i) => i.confidence === "high") }, "Select all high-confidence"),
        h("button", { type: "button", class: "secondary small", onclick: () => setAll(() => false) }, "Clear all"),
      ]),
      ...groups.map((g) => { const gid = nextId("group"); return h("div", { class: "intake-group", role: "group", "aria-labelledby": gid }, [
        h("h4", { id: gid }, g.title),
        h("ul", { class: "intake-list" }, g.items.filter((i) => !i.conflict).map(row)),
        ...g.items.filter((i) => i.conflict).map(row),
      ]); }),
      h("div", { class: "intake-actions intake-apply" }, [
        applyBtn,
        h("button", { type: "button", class: "secondary", onclick: () => onDiscard && onDiscard() }, "Discard"),
      ]),
    ]);
  }

  function summary(h, { fileName, filled, skipped, errors, onGo }) {
    const head = nextId("head");
    const failed = errors && errors.length;
    return h("section", { class: "intake-panel", "aria-labelledby": head }, [
      h("h3", { id: head, tabindex: "-1" }, failed ? "Nothing was filled" : "Values filled from the PDF"),
      failed
        ? h("p", {}, `The selected values from ${fileName} didn't pass the project's checks, so nothing was changed:`)
        : h("p", {}, `${plural(filled, "value")} filled from ${fileName}. Check them in Steps 1–3; fields filled from the PDF say so until you edit them.`),
      !failed && skipped ? h("p", { class: "intake-meta" }, `${plural(skipped, "value")} left out because ${skipped === 1 ? "it belongs" : "they belong"} to rooms or forms this dosage form category doesn't use.`) : null,
      failed ? h("ul", { class: "intake-errors" }, errors.slice(0, 10).map((e) => h("li", {}, e))) : null,
      h("div", { class: "intake-actions" }, [1, 2, 3].map((n) => h("button", { type: "button", class: "secondary small", onclick: () => onGo && onGo(n) }, `Go to Step ${n}`))),
    ]);
  }

  return { uploadPanel, progress, review, summary };
});
