// Fields explorer: reads /scalars.json and shows one type at a time. No dependencies.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const code = (s) => `<code>${esc(s)}</code>`;
const pre = (v) => `<pre>${esc(typeof v === "string" ? v : JSON.stringify(v, null, 2))}</pre>`;

let data, types, current;
const levels = new Set(["core", "advanced", "domain"]);

fetch("scalars.json")
    .then((r) => r.json())
    .then((json) => {
        data = json;
        types = Object.values(json.types);
        $("version").textContent = "v" + json.version;
        $("levels").innerHTML = [...levels]
            .map((l) => `<label><input type="checkbox" value="${l}" checked> ${l}</label>`)
            .join("");
        $("levels").onchange = (e) => {
            e.target.checked ? levels.add(e.target.value) : levels.delete(e.target.value);
            renderList();
        };
        $("search").oninput = renderList;
        window.onhashchange = () => show(location.hash.slice(1));
        renderList();
        show(location.hash.slice(1) || types[0].name);
    })
    .catch((err) => ($("detail").innerHTML = `<p class="bad">Could not load scalars.json: ${esc(err)}</p>`));

function renderList() {
    const q = $("search").value.trim().toLowerCase();
    const hit = (t) =>
        levels.has(t.level) &&
        (!q || [t.name, t.label, ...(t.aliases || [])].some((s) => s.toLowerCase().includes(q)));
    $("list").innerHTML = types
        .filter(hit)
        .map((t) => `<li data-name="${t.name}" class="${t.name === current ? "active" : ""}">
            ${esc(t.name)} <span>${esc(t.label)}</span></li>`)
        .join("");
    $("list").onclick = (e) => {
        const li = e.target.closest("li");
        if (li) location.hash = li.dataset.name;
    };
}

function show(name) {
    const t = data.types[name];
    if (!t) return;
    current = name;
    document.querySelectorAll("#list li").forEach((li) => li.classList.toggle("active", li.dataset.name === name));
    const meta = data.$meta;
    const rows = [
        ["primitive", code(t.primitive)],
        ["standard", t.standard && esc(t.standard)],
        ["docs", t.docs_link && `<a href="${esc(t.docs_link)}" target="_blank" rel="noopener">${esc(t.docs_link)}</a>`],
        ["aliases", t.aliases && t.aliases.map(code).join(" ")],
        ["alternative", t.alternative && `<a href="#${esc(t.alternative)}">${esc(t.alternative)}</a>`],
        ["hint", t.hint && esc(t.hint)],
        ["error", t.error && esc(t.error)],
    ].filter(([, v]) => v);

    const ex = t.examples || {};
    const exCol = (key, cls, title) =>
        ex[key] ? `<div><b class="${cls}">${title}</b><ul>${ex[key].map((v) => `<li>${code(v)}</li>`).join("")}</ul></div>` : "";

    $("detail").innerHTML = `
        <h2>${esc(t.label)} <span class="muted">${esc(t.name)}</span></h2>
        <span class="tag ${t.level}">${t.level}</span>
        <p>${esc(t.details || "")}</p>
        <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>

        <h3>Try it <span class="muted">(browser check of the HTML attributes only)</span></h3>
        <div id="try"></div>
        <p id="try-result" class="muted"></p>

        <h3>Examples</h3>
        <div class="examples">
            ${exCol("valid", "ok", "valid")}
            ${exCol("invalid", "bad", "invalid")}
            ${exCol("check_invalid", "bad", "fails the check")}
            ${exCol("list_valid", "ok", "list valid")}
            ${exCol("list_invalid", "bad", "list invalid")}
        </div>

        ${t.normalize ? `<h3>Normalize</h3><table>${t.normalize.map((s) => `<tr><td>${code(s)}</td><td>${esc(meta.normalize_steps[s] || "")}</td></tr>`).join("")}</table>` : ""}
        ${t.check ? `<h3>Check</h3><p>${code(t.check)} ${esc(meta.checks[t.check] || "")}</p>` : ""}
        ${t.params ? `<h3>Settings</h3><table>${t.params.map((p) => `<tr><td>${code(p)}</td><td>${esc(meta.params[p]?.description || "")}</td></tr>`).join("")}</table>` : ""}

        <h3>HTML</h3>${t.html?.note ? `<p>${esc(t.html.note)}</p>` : ""}${pre(t.html)}
        <h3>JSON Schema</h3>${pre(t.schema)}
        <h3>Postgres</h3>${t.postgres?.note ? `<p>${esc(t.postgres.note)}</p>` : ""}${pre(t.postgres)}
    `;
    renderTry(t);
}

// Build the real form control from the type's html block, so the page shows exactly what a form would get.
function renderTry(t) {
    const html = t.html || { element: "input", attrs: {} };
    const el = document.createElement(html.element);
    for (const [k, v] of Object.entries(html.attrs || {})) el.setAttribute(k, v);
    if (html.element === "select") el.innerHTML = `<option value="">(options come from the field's values)</option>`;
    const out = $("try-result");
    const check = () => {
        if (el.type === "checkbox") return (out.textContent = `value: ${el.checked}`);
        if (el.value === "") return (out.textContent = "");
        out.className = el.validity.valid ? "ok" : "bad";
        out.textContent = el.validity.valid ? "Looks valid" : el.validationMessage || t.error;
    };
    el.oninput = el.onchange = check;
    $("try").replaceChildren(el);
}
