"use strict";
const $ = (id) => document.getElementById(id),
  LANG = window.VPN_LOCALE || "en",
  TEXT = window.VPN_TEXT || {},
  token = document.querySelector('meta[name="vidaa-vpn-token"]').content,
  API = document.querySelector('meta[name="vidaa-vpn-api"]').content,
  DEMO =
    document.querySelector('meta[name="vidaa-vpn-mode"]').content === "demo";
const t = (key, values = {}) =>
  String(TEXT[key] || TEXT.ACTION_FAILED || key).replace(/\{(\w+)\}/g, (_, k) =>
    String(values[k] ?? ""),
  );
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const PATH = {
  power: '<path d="M12 2v10m-6-7a9 9 0 1 0 12 0"/>',
  shield:
    '<path d="M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z"/><path d="M8 12l3 3 5-6"/>',
  servers:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M8 7h8M8 18h8"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  star: '<path d="M12 2l3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z"/>',
};
const icon = (name) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  PATH[name] +
  "</svg>";
let state = null,
  view = "home",
  filter = "all",
  sort = "default",
  busy = false,
  polling = false,
  modalOwner = null,
  probeSince = 0,
  securitySince = 0,
  toastTimer = null,
  signatures = {},
  favorites = [],
  activity = [];
try {
  favorites = JSON.parse(localStorage.getItem("vidaa-vpn-favorites") || "[]");
  activity = JSON.parse(localStorage.getItem("vidaa-vpn-activity") || "[]");
  if (!Array.isArray(favorites)) favorites = [];
  if (!Array.isArray(activity)) activity = [];
} catch (_) {}
function save() {
  try {
    localStorage.setItem("vidaa-vpn-favorites", JSON.stringify(favorites));
    localStorage.setItem("vidaa-vpn-activity", JSON.stringify(activity));
  } catch (_) {}
}
function note(code) {
  activity.unshift({ time: Date.now(), code });
  activity = activity.slice(0, 8);
  save();
  signatures.diagnostics = "";
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function focus(el) {
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function list() {
  return state?.settings?.profiles || [];
}
function current() {
  return list().find((p) => p.id === state.settings.selected) || null;
}
function locationName(p) {
  if (!p) return { name: t("noServer"), flag: "◉" };
  for (const [re, key, flag] of [
    [/🇩🇪|Герман|Germany|Frankfurt/i, "Germany", "🇩🇪"],
    [/🇫🇮|Финлян|Finland|Helsinki/i, "Finland", "🇫🇮"],
    [/🇳🇱|Нидерланд|Netherlands|Amsterdam/i, "Netherlands", "🇳🇱"],
    [/🇵🇱|Польш|Poland|Warsaw/i, "Poland", "🇵🇱"],
  ])
    if (re.test(p.title)) return { name: t(key), flag };
  return { name: p.title, flag: "◉" };
}
function detail(p) {
  return /^(?:🇩🇪|🇫🇮|🇳🇱|🇵🇱)?\s*(?:Germany|Finland|Netherlands|Poland|Германия|Финляндия|Нидерланды|Польша)\s*$/i.test(
    p.title,
  )
    ? ""
    : p.title;
}
const protocol = (p) =>
  ({ vless: "VLESS", anytls: "AnyTLS", naive: "Naive", mieru: "Mieru" })[p] ||
  p;
const ping = (id) => state?.probes?.results?.find((p) => p.id === id);
function pingText(p) {
  const r = p && ping(p.id);
  return !r
    ? "—"
    : r.ok
      ? r.ms + " " + t("ms")
      : r.error === "udp-endpoint"
        ? "UDP"
        : t("noReply");
}
function bytes(n) {
  if (n == null) return "—";
  const units = [t("bytes"), t("kb"), t("mb"), t("gb")];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return (i ? n.toFixed(1) : n) + " " + units[i];
}
function duration(start) {
  if (!start) return "—";
  const v = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return [Math.floor(v / 3600), Math.floor(v / 60) % 60, v % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}
const time = (x) =>
  x
    ? new Date(x).toLocaleTimeString(LANG, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const button = (id, label, cls = "", extra = "") =>
  '<button id="' +
  id +
  '" data-focus class="' +
  cls +
  '" ' +
  extra +
  ">" +
  label +
  "</button>";
function freshSecurity() {
  const r = state?.security;
  return !!(
    state?.running &&
    r &&
    !r.running &&
    r.profileId === state.settings.selected &&
    (!state.session?.started || r.started >= state.session.started)
  );
}
function home() {
  const p = current(),
    place = locationName(p),
    on = state.running;
  return (
    '<div class="hero-grid"><div class="card hero"><div class="status-line ' +
    (on ? "on" : "") +
    '"><i></i>' +
    t(on ? "on" : "off") +
    '</div><div class="connect-center">' +
    button(
      "connect",
      icon("power"),
      "power " + (on ? "connected" : ""),
      'aria-label="' +
        t(on ? "disconnect" : "connect") +
        '" ' +
        (busy || !p ? "disabled" : ""),
    ) +
    '</div><div class="server-summary"><div class="server-place"><div class="flag">' +
    place.flag +
    "</div><div><strong>" +
    esc(place.name) +
    "</strong><small>" +
    esc(p ? protocol(p.protocol) + " · " + pingText(p) : "") +
    "</small></div></div>" +
    button("change", t(p ? "change" : "noServer"), "compact") +
    '</div></div><div class="side-stack"><div class="card"><div class="connection-data">' +
    [
      ["session", duration(state.session?.started)],
      ["latency", pingText(p)],
      ["download", bytes(on ? state.session?.download : null)],
      ["upload", bytes(on ? state.session?.upload : null)],
    ]
      .map(
        ([key, value]) =>
          '<div><div class="metric-label">' +
          t(key) +
          '</div><div class="metric">' +
          esc(value) +
          "</div></div>",
      )
      .join("") +
    '</div></div><div class="card"><div class="card-title">' +
    icon("shield") +
    t("internet") +
    '</div><div class="muted">' +
    (freshSecurity() && state.security.connectivity?.ok
      ? t("available") + " · " + esc(state.security.connectivity.country)
      : t(on ? "notChecked" : "off")) +
    "</div>" +
    button(
      "home-check",
      t(state.security?.running ? "checking" : "checkConnection"),
      "full secondary",
      state.security?.running ? 'aria-disabled="true"' : "",
    ) +
    "</div></div></div>"
  );
}
function servers() {
  const pending = state.probes?.running,
    items = list().filter(
      (p) =>
        filter === "all" ||
        (filter === "favorites" && favorites.includes(p.id)) ||
        p.protocol === filter,
    );
  if (sort === "latency")
    items.sort(
      (a, b) =>
        (ping(a.id)?.ok ? ping(a.id).ms : Infinity) -
        (ping(b.id)?.ok ? ping(b.id).ms : Infinity),
    );
  if (sort === "country")
    items.sort((a, b) =>
      locationName(a).name.localeCompare(locationName(b).name, LANG),
    );
  const filters = [
    "all",
    ...new Set(list().map((p) => p.protocol)),
    "favorites",
  ];
  return (
    '<div class="toolbar"><div class="filters">' +
    filters
      .map((k) =>
        button(
          "filter-" + k,
          esc(k === "all" || k === "favorites" ? t(k) : protocol(k)),
          "chip " + (filter === k ? "active" : ""),
          'aria-pressed="' + (filter === k) + '"',
        ),
      )
      .join("") +
    '</div><div class="toolbar-actions">' +
    button(
      "sort",
      t(
        sort === "default"
          ? "sort"
          : sort === "latency"
            ? "sortLatency"
            : "sortCountry",
      ),
      "secondary",
    ) +
    button(
      "ping",
      icon("pulse") + " " + t(pending ? "checking" : "ping"),
      "primary",
      pending ? 'aria-disabled="true"' : "",
    ) +
    "</div></div>" +
    (pending
      ? '<div class="muted">' +
        state.probes.results.length +
        " / " +
        state.probes.total +
        "</div>"
      : "") +
    '<div class="server-list">' +
    (items.length
      ? items
          .map((p) => {
            const loc = locationName(p),
              r = ping(p.id),
              fav = favorites.includes(p.id),
              selected = p.id === state.settings.selected;
            return (
              '<div class="server-row">' +
              button(
                "select-" + p.id,
                '<div class="server-left"><div class="flag">' +
                  loc.flag +
                  '</div><div style="min-width:0"><div class="server-title">' +
                  esc(loc.name) +
                  '</div><div class="server-meta"><span class="badge">' +
                  esc(protocol(p.protocol)) +
                  "</span>" +
                  (detail(p) ? "<span>" + esc(detail(p)) + "</span>" : "") +
                  "" +
                  (selected
                    ? '<span class="badge active">' + t("selected") + "</span>"
                    : "") +
                  '</div></div></div><div class="latency ' +
                  (r?.ok ? "good" : "") +
                  '">' +
                  esc(pingText(p)) +
                  "</div>",
                "server-button " + (selected ? "current" : ""),
                'aria-label="' +
                  esc(
                    t("selectServer", {
                      country: loc.name,
                      protocol: protocol(p.protocol),
                    }),
                  ) +
                  '" ' +
                  (busy ? "disabled" : ""),
              ) +
              button(
                "fav-" + p.id,
                icon("star"),
                "star " + (fav ? "favorite" : ""),
                'aria-pressed="' +
                  fav +
                  '" aria-label="' +
                  t(fav ? "removeFavorite" : "addedFavorite") +
                  '"',
              ) +
              "</div>"
            );
          })
          .join("")
      : '<div class="card empty">' +
        t(filter === "favorites" ? "emptyFavorites" : "empty") +
        "</div>") +
    "</div>"
  );
}
function subscription() {
  return (
    '<div class="subscription-grid"><div class="card"><div class="subscription-host">' +
    esc(state.settings.subscriptionHost || t("noSubscription")) +
    "</div>" +
    button(
      "refresh",
      icon("refresh") + " " + t("refresh"),
      "primary full",
      busy ? "disabled" : "",
    ) +
    '<label class="form-label" for="subscription-url">' +
    t("newLink") +
    '</label><input id="subscription-url" data-focus type="password" autocomplete="off" spellcheck="false" placeholder="https://…" ' +
    (busy ? "disabled" : "") +
    '><div class="form-actions">' +
    button(
      "save-subscription",
      t("saveRefresh"),
      "secondary",
      busy ? "disabled" : "",
    ) +
    "</div></div></div>"
  );
}
const checkIds = [
  "private-files",
  "control-access",
  "tls-verification",
  "encrypted-app-dns",
  "ipv6-dns",
  "local-proxies",
  "manual-start",
  "trusted-ca",
  "ipv6-tunnel",
];
function diagnostics() {
  const report = state.security,
    connection = freshSecurity() ? report.connectivity : null;
  return (
    '<div class="diagnostic-grid"><div class="card"><div class="toolbar"><h2 class="section-heading">' +
    t("localCheck") +
    "</h2>" +
    button(
      "security",
      t(report?.running ? "checking" : "check"),
      "primary",
      report?.running ? 'aria-disabled="true"' : "",
    ) +
    "</div>" +
    checkIds
      .map((id) => {
        const c = report?.checks?.find((c) => c.id === id);
        return (
          '<div class="check-row"><span>' +
          t(id) +
          '</span><span class="check-value ' +
          (c ? (c.ok ? "ok" : "bad") : "") +
          '">' +
          t(c ? (c.ok ? "checked" : "attention") : "notChecked") +
          "</span></div>"
        );
      })
      .join("") +
    '<div class="check-row"><span>' +
    t("memory") +
    '</span><span class="check-value">' +
    (state.running ? esc(state.memoryMiB) + " " + t("mb") : "—") +
    '</span></div><div class="check-row"><span>' +
    t("internet") +
    '</span><span class="check-value ' +
    (connection ? (connection.ok ? "ok" : "bad") : "") +
    '">' +
    (connection
      ? connection.ok
        ? t("available") + " · " + esc(connection.country)
        : t("unconfirmed")
      : t(state.running ? "notChecked" : "off")) +
    '</span></div><div class="list-note">' +
    (report
      ? t("lastCheck", { time: time(report.finished || report.started) })
      : "") +
    '</div></div><div class="card"><div class="toolbar"><h2 class="section-heading">' +
    t("history") +
    "</h2>" +
    button("clear-activity", t("clear"), "compact secondary") +
    "</div>" +
    (activity.length
      ? activity
          .map(
            (a) =>
              '<div class="activity-line"><span>' +
              time(a.time) +
              "</span>" +
              esc(t(a.code)) +
              "</div>",
          )
          .join("")
      : '<div class="muted">' + t("emptyHistory") + "</div>") +
    "</div></div>"
  );
}
function render(force = false) {
  if (!state) return;
  const signature = JSON.stringify([
    view,
    view === "subscription" ? state.settings : state,
    busy,
    filter,
    sort,
    favorites,
    activity,
  ]);
  if (!force && signatures[view] === signature) return;
  signatures[view] = signature;
  const root = $("view-" + view),
    active = document.activeElement,
    activeId = active?.id,
    inside = root.contains(active),
    scroll = $("content").scrollTop,
    input = $("subscription-url"),
    value = input?.value;
  root.innerHTML = { home, servers, subscription, diagnostics }[view]();
  if (value !== undefined && $("subscription-url"))
    $("subscription-url").value = value;
  if (inside && activeId && $(activeId) && !$(activeId).disabled) {
    $(activeId).focus({ preventScroll: true });
    $("content").scrollTop = scroll;
  }
}
function visible(root = document) {
  return Array.from(root.querySelectorAll("[data-focus]")).filter(
    (el) => !el.disabled && el.getClientRects().length > 0,
  );
}
function switchView(next, move = true) {
  view = next;
  for (const key of ["home", "servers", "subscription", "diagnostics"]) {
    $("view-" + key).hidden = key !== view;
    $("nav-" + key).classList.toggle("selected", key === view);
  }
  $("view-title").textContent = t(view);
  $("nav").setAttribute("aria-label", t("navigation"));
  $("content").scrollTop = 0;
  render();
  if (move) focus(visible($("view-" + view))[0]);
}
async function api(action, args = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 12000);
  try {
    const endpoint = API + (action === "status" ? "status" : "action"),
      r = await fetch(endpoint, {
        method: "POST",
        headers: { identifier: "", "Content-Type": "application/json" },
        body: JSON.stringify({ ...args, token, action }),
        signal: controller.signal,
      });
    if (!r.ok) throw Error("ACTION_FAILED");
    const data = await r.json();
    if (data.error) throw Error(data.error);
    return data;
  } finally {
    clearTimeout(timer);
  }
}
async function poll() {
  if (polling || busy) return;
  polling = true;
  try {
    state = await api("status");
    $("footer-status").textContent = "";
    if (
      probeSince &&
      state.probes?.started >= probeSince &&
      !state.probes.running
    ) {
      probeSince = 0;
      note("pingDone");
      toast(t("pingDone"));
    }
    if (
      securitySince &&
      state.security?.started >= securitySince &&
      !state.security.running
    ) {
      securitySince = 0;
      note("securityDone");
      toast(t("securityDone"));
    }
    render();
  } catch (_) {
    $("footer-status").textContent = t("serviceError");
  } finally {
    polling = false;
  }
}
async function act(action, args = {}) {
  if (busy) return false;
  busy = true;
  render(true);
  let success = false;
  try {
    const request = await api(action, args);
    for (let i = 0; i < 85; i++) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      state = await api("status");
      if (state.result?.time >= request.since) {
        success = !!state.result.ok;
        const code =
          state.result.code ||
          (success
            ? action === "start"
              ? "on"
              : action === "stop"
                ? "off"
                : "SERVER_SELECTED"
            : "ACTION_FAILED");
        toast(t(code));
        note(code);
        break;
      }
    }
  } catch (error) {
    toast(t(error.message));
    note("ACTION_FAILED");
  } finally {
    busy = false;
    render(true);
    focus(visible($("view-" + view))[0]);
  }
  return success;
}
async function check(action) {
  try {
    const request = await api(action);
    if (action === "probe") {
      probeSince = request.since;
      state.probes = {
        started: request.since,
        running: true,
        total: list().length,
        results: [],
      };
    } else {
      securitySince = request.since;
      state.security = {
        started: request.since,
        running: true,
        checks: [],
        profileId: state.settings.selected,
      };
    }
    render(true);
  } catch (error) {
    toast(t(error.message));
  }
}
function modal(owner, title, html) {
  modalOwner = owner;
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal").hidden = false;
  focus(visible($("modal"))[0]);
}
function closeModal() {
  const owner = modalOwner;
  modalOwner = null;
  $("modal").hidden = true;
  $("modal-body").replaceChildren();
  focus($(owner));
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
  const id = b.id;
  if (b.dataset.view) {
    switchView(b.dataset.view, false);
    return;
  }
  if (id === "language") {
    location.href = DEMO
      ? "../" + (LANG === "ru" ? "en" : "ru") + "/index.html"
      : "https://localhost:9888/function/basic/fetch/fetchresponse_vidaa_vpn_ui?lang=" +
        (LANG === "ru" ? "en" : "ru");
    return;
  }
  if (id === "help") {
    modal(
      id,
      t("helpTitle"),
      '<p class="diag-copy">' +
        esc(t("helpText")) +
        '</p><p class="diag-copy">' +
        esc(t("helpPrivacy")) +
        "</p>",
    );
    return;
  }
  if (id === "modal-cancel") {
    closeModal();
    return;
  }
  if (id === "connect") act(state.running ? "stop" : "start");
  else if (id === "change")
    switchView(list().length ? "servers" : "subscription");
  else if (id === "home-check" || id === "security") check("security");
  else if (id === "ping") check("probe");
  else if (id === "sort")
    modal(
      id,
      t("sort"),
      [
        ["default", "sortDefault"],
        ["latency", "sortLatency"],
        ["country", "sortCountry"],
      ]
        .map(([value, key]) =>
          button(
            "sort-" + value,
            t(key),
            sort === value ? "primary" : "secondary",
          ),
        )
        .join(""),
    );
  else if (id.startsWith("sort-")) {
    sort = id.slice(5);
    closeModal();
    render(true);
    focus($("sort"));
  } else if (id.startsWith("filter-")) {
    filter = id.slice(7);
    render(true);
    focus($(id));
  } else if (id.startsWith("fav-")) {
    const value = id.slice(4);
    favorites = favorites.includes(value)
      ? favorites.filter((id) => id !== value)
      : favorites.concat(value);
    save();
    render(true);
    focus($(id));
  } else if (id.startsWith("select-")) {
    const value = id.slice(7);
    if (value === state.settings.selected) toast(t("alreadySelected"));
    else act("select", { id: value });
  } else if (id === "refresh") act("update");
  else if (id === "save-subscription") {
    const url = $("subscription-url").value.trim();
    if (!/^https:\/\//i.test(url)) {
      toast(t("enterHttps"));
      focus($("subscription-url"));
      return;
    }
    if (await act("update", { url })) $("subscription-url").value = "";
  } else if (id === "clear-activity") {
    activity = [];
    save();
    render(true);
    toast(t("historyCleared"));
  }
});
function consume(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
function navigate(key) {
  const active = document.activeElement;
  if (modalOwner) {
    const items = visible($("modal")),
      index = items.indexOf(active);
    focus(
      items[
        Math.max(
          0,
          Math.min(
            items.length - 1,
            index + (key === 37 || key === 38 ? -1 : 1),
          ),
        )
      ],
    );
    return;
  }
  const nav = visible($("nav"));
  if ($("nav").contains(active)) {
    if (key === 39) focus(visible($("view-" + view))[0]);
    else if (key === 38 || key === 40)
      focus(
        nav[
          Math.max(
            0,
            Math.min(
              nav.length - 1,
              nav.indexOf(active) + (key === 38 ? -1 : 1),
            ),
          )
        ],
      );
    return;
  }
  const items = visible($("content"));
  if (!items.includes(active)) {
    focus(items[0] || $("nav-" + view));
    return;
  }
  const rect = active.getBoundingClientRect(),
    x = rect.left + rect.width / 2,
    y = rect.top + rect.height / 2,
    candidates = [];
  for (const item of items) {
    if (item === active) continue;
    const r = item.getBoundingClientRect(),
      dx = r.left + r.width / 2 - x,
      dy = r.top + r.height / 2 - y,
      p = key === 37 ? -dx : key === 39 ? dx : key === 38 ? -dy : dy,
      cross = key === 37 || key === 39 ? Math.abs(dy) : Math.abs(dx);
    if (
      p > 8 &&
      (!(key === 37 || key === 39) ||
        cross < Math.max(85, (rect.height + r.height) / 2))
    )
      candidates.push({ item, score: p + cross * 2.2 });
  }
  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length) focus(candidates[0].item);
  else if (key === 37) focus($("nav-" + view));
  else if (key === 38 || key === 40)
    $("content").scrollBy({ top: key === 40 ? 200 : -200, behavior: "smooth" });
}
document.addEventListener(
  "keydown",
  (event) => {
    const key = event.keyCode || event.which,
      active = document.activeElement;
    if ([27, 461, 10009].includes(key)) {
      consume(event);
      if (modalOwner) closeModal();
      else if (view !== "home") switchView("home");
      else focus($("nav-home"));
      return;
    }
    if ([37, 38, 39, 40].includes(key)) {
      if (active?.tagName === "INPUT" && (key === 37 || key === 39)) return;
      consume(event);
      navigate(key);
    } else if (key === 13) {
      if (active?.tagName === "BUTTON") {
        consume(event);
        if (!event.repeat) active.click();
      } else if (active?.tagName === "INPUT") {
        consume(event);
        focus($("save-subscription"));
      }
    }
  },
  true,
);
document.addEventListener(
  "keyup",
  (event) => {
    const key = event.keyCode || event.which,
      active = document.activeElement;
    if (
      [37, 38, 39, 40].includes(key) &&
      !(active?.tagName === "INPUT" && (key === 37 || key === 39))
    )
      consume(event);
    if (key === 13 && active?.tagName === "BUTTON") consume(event);
  },
  true,
);
for (const [key, name] of [
  ["home", "shield"],
  ["servers", "servers"],
  ["subscription", "refresh"],
  ["diagnostics", "pulse"],
])
  $("nav-" + key).innerHTML = icon(name) + "<span>" + t(key) + "</span>";
$("nav").setAttribute("aria-label", t("navigation"));
$("view-title").textContent = t("home");
$("help").textContent = t("help");
$("language").textContent = LANG === "ru" ? "EN" : "RU";
$("modal-cancel").textContent = t("cancel");
poll().then(() =>
  focus($("connect") && !$("connect").disabled ? $("connect") : $("nav-home")),
);
setInterval(poll, 3000);
