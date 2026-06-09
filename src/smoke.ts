/**
 * Offline smoke test (no MCP transport): exercises the pure logic so we can
 * verify the server's building blocks without a client. Run: npm run smoke
 */
import {
  createElement,
  CONTAINER_TYPES,
  FIELD_TYPES,
  LIBRARY,
  ELEMENT_TYPES,
  ELEMENTS,
} from "./domains/landing/elements/index.js";
import { validatePage, pageSchema } from "./domains/landing/validate.js";
import { expandSource } from "./core/expand.js";
import { readConfig, resolveEnv, ENV_NAMES } from "./persistence/config.js";
import { toEditorUrl } from "./persistence/webcake-client.js";
import { normalizePhoto, resolvePexelsKey, pexelsKeyFromHeaders, resolvePexelsProxyBase, buildSearchQuery, PEXELS_PROXY_DEFAULT } from "./persistence/pexels-client.js";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}`, extra ?? "");
  }
};

const setEq = (a: Set<string>, b: string[]) =>
  a.size === b.length && b.every((t) => a.has(t));

console.log("== descriptors: the single source of truth is well-formed ==");
{
  const seen = new Map<string, number>();
  for (const d of ELEMENTS) seen.set(d.type, (seen.get(d.type) || 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([t]) => t);
  check("no duplicate descriptor types", dups.length === 0, dups);
  check(
    "every descriptor has defaultName/summary/useWhen",
    ELEMENTS.every((d) => !!d.defaultName && !!d.summary && !!d.useWhen),
    ELEMENTS.filter((d) => !d.defaultName || !d.summary || !d.useWhen).map((d) => d.type)
  );
  check("LIBRARY keys match ELEMENT_TYPES", setEq(new Set(ELEMENT_TYPES), Object.keys(LIBRARY)), {
    libraryKeys: Object.keys(LIBRARY).length,
    elementTypes: ELEMENT_TYPES.length,
  });
  check("FIELD_TYPES ⊆ ELEMENT_TYPES", [...FIELD_TYPES].every((t) => ELEMENT_TYPES.includes(t)), [...FIELD_TYPES].filter((t) => !ELEMENT_TYPES.includes(t)));
}

console.log("== derived sets equal the known-good container/field lists (parity) ==");
{
  const EXPECTED_CONTAINERS = [
    "section", "dynamic_page", "group", "grid", "grid-item", "carousel", "slide", "popup",
    "form", "checkbox-group", "radio", "group-select",
  ];
  const EXPECTED_FIELDS = [
    "input", "textarea", "select", "checkbox", "checkbox-group", "radio",
    "address", "country-select", "quantity_input", "input-datetime",
    "input-file", "signature", "verify-code", "group-select-item",
  ];
  check("CONTAINER_TYPES matches expected", setEq(CONTAINER_TYPES, EXPECTED_CONTAINERS), [...CONTAINER_TYPES]);
  check("FIELD_TYPES matches expected", setEq(FIELD_TYPES, EXPECTED_FIELDS), [...FIELD_TYPES]);
}

console.log("== factory: every library type produces a valid skeleton ==");
for (const type of Object.keys(LIBRARY)) {
  const el = createElement(type);
  const okBase =
    typeof el.id === "string" &&
    el.type === type &&
    !!el.responsive.desktop &&
    !!el.responsive.mobile &&
    typeof el.specials === "object";
  const okChildren = CONTAINER_TYPES.has(type) ? Array.isArray(el.children) : el.children === undefined;
  check(`skeleton ${type}`, okBase && okChildren, el);
}

console.log("== validate: a good page passes ==");
const good = {
  page: [
    {
      id: "sec1",
      type: "section",
      properties: { name: "Hero", movable: false, sync: true },
      responsive: {
        desktop: { config: {}, styles: { position: "relative", height: 600, background: "rgba(17,24,39,1)" } },
        mobile: { config: {}, styles: { position: "relative", height: 520, background: "rgba(17,24,39,1)" } },
      },
      specials: {},
      runtime: {},
      events: [],
      children: [
        {
          id: "btn1",
          type: "button",
          properties: { name: "CTA", movable: true, sync: true },
          responsive: {
            desktop: { config: {}, styles: { top: 300, left: 400, width: 160, height: 44 } },
            mobile: { config: {}, styles: { top: 200, left: 130, width: 160, height: 44 } },
          },
          specials: { text: "Mở popup" },
          runtime: {},
          events: [{ id: "e1", type: "click", action: "open_popup", target: "pop1" }],
        },
      ],
    },
    {
      id: "pop1",
      type: "popup",
      properties: { name: "Thanks", movable: false, sync: true },
      responsive: {
        desktop: { config: {}, styles: { width: 420, height: 220 } },
        mobile: { config: {}, styles: { width: 360, height: 220 } },
      },
      specials: {},
      runtime: {},
      events: [],
      children: [],
    },
  ],
  settings: { title: "Demo", description: "d", keywords: "a,b", lang: "vi" },
};
const r1 = validatePage(good);
check("good page valid", r1.valid, r1.errors);
check("good page has no dangling-target warnings", r1.warnings.length === 0, r1.warnings);
check("good page stats", r1.stats.sections === 2 && r1.stats.ids === 3, r1.stats);

console.log("== validate: catches problems ==");
const bad = {
  page: [
    {
      id: "dup",
      type: "text-block", // not a container, but has children -> error
      properties: { name: "x" },
      responsive: { desktop: { config: {}, styles: {} } }, // missing mobile -> error
      specials: {},
      children: [{ id: "dup", type: "input", properties: {}, responsive: { desktop: { config: {}, styles: {} }, mobile: { config: {}, styles: {} } }, specials: {} }],
    },
  ],
};
const r2 = validatePage(bad);
check("bad page invalid", !r2.valid, r2);
check("bad page detects duplicate id", r2.errors.some((e) => e.includes("Duplicate id")), r2.errors);
check("bad page detects children-on-noncontainer", r2.errors.some((e) => e.includes("not a container")), r2.errors);
check("bad page detects missing mobile", r2.errors.some((e) => e.toLowerCase().includes("mobile")), r2.errors);
check("bad page warns missing field_name", r2.warnings.some((w) => w.includes("field_name")), r2.warnings);

console.log("== validate: accepts JSON string input ==");
const r3 = validatePage(JSON.stringify(good));
check("string input parsed & valid", r3.valid, r3.errors);

console.log("== expand: hydrates sparse nodes ==");
const sparse = {
  page: [
    {
      type: "section",
      id: "s_hero",
      responsive: { desktop: { styles: { height: 600 } }, mobile: { styles: { height: 520 } } },
      children: [
        {
          type: "text-block",
          id: "t_h1",
          responsive: {
            desktop: { styles: { top: 120, left: 80, width: 500, height: 70, fontSize: 48 } },
            mobile: { styles: { top: 100, left: 20, width: 380, height: 60, fontSize: 32 } },
          },
          specials: { text: "Sparse hero" },
        },
      ],
    },
  ],
  settings: { title: "x", description: "d", keywords: "a", lang: "vi" },
};
const exp: any = expandSource(sparse, createElement);
const eSec = exp.page[0];
const eTxt = eSec.children[0];
check("expand fills properties (sync default)", eSec.properties?.sync === true, eSec.properties);
check("expand fills empty runtime/events", typeof eTxt.runtime === "object" && Array.isArray(eTxt.events) && eTxt.events.length === 0, eTxt);
check("expand fills breakpoint config animation", eTxt.responsive.desktop.config?.animation?.name === "none", eTxt.responsive.desktop.config);
check("expand preserves provided styles", eTxt.responsive.desktop.styles.fontSize === 48 && eTxt.responsive.desktop.styles.top === 120, eTxt.responsive.desktop.styles);
check("expand keeps id/type/specials", eTxt.id === "t_h1" && eTxt.type === "text-block" && eTxt.specials.text === "Sparse hero", eTxt);
check("expanded sparse page validates", validatePage(exp).valid, validatePage(exp).errors);
check("expand(full good page) still valid", validatePage(expandSource(good, createElement)).valid);

console.log("== library: each example validates as a single element subtree ==");
for (const [type, doc] of Object.entries(LIBRARY)) {
  if (!doc.example) continue;
  const wrapped = {
    page: [
      {
        id: "wrapsec",
        type: "section",
        properties: { name: "w", movable: false, sync: true },
        responsive: { desktop: { config: {}, styles: { position: "relative", height: 800 } }, mobile: { config: {}, styles: { position: "relative", height: 800 } } },
        specials: {},
        runtime: {},
        events: [],
        children: [doc.example],
      },
    ],
  };
  const rr = validatePage(wrapped);
  check(`example ${type} valid`, rr.valid, rr.errors);
}

console.log("== schema enum stays in sync with LIBRARY (single source of truth) ==");
const enumTypes: string[] = (pageSchema as any).$defs?.elementType?.enum ?? [];
const libTypes = Object.keys(LIBRARY);
check("every LIBRARY type is in the schema enum", libTypes.every((t) => enumTypes.includes(t)), libTypes.filter((t) => !enumTypes.includes(t)));
check("every schema enum type is in LIBRARY", enumTypes.every((t) => libTypes.includes(t)), enumTypes.filter((t) => !libTypes.includes(t)));

console.log("== validate: form-data binding checks ==");
const mkBox = () => ({ desktop: { config: {}, styles: {} }, mobile: { config: {}, styles: {} } });
const bindingsBad = {
  page: [
    {
      id: "secf", type: "section",
      properties: { name: "F", movable: false, sync: true },
      responsive: { desktop: { config: {}, styles: { position: "relative", height: 800 } }, mobile: { config: {}, styles: { position: "relative", height: 800 } } },
      specials: {}, runtime: {}, events: [],
      children: [
        {
          id: "frm1", type: "form",
          properties: { name: "Form", movable: true, sync: true },
          responsive: mkBox(), specials: {}, runtime: {}, events: [],
          children: [
            { id: "i1", type: "input", properties: {}, responsive: mkBox(), specials: { field_name: "phone_number" }, events: [] },
            { id: "i2", type: "input", properties: {}, responsive: mkBox(), specials: { field_name: "phone_number" }, events: [] },
            { id: "rad1", type: "radio", properties: {}, responsive: mkBox(),
              specials: { field_name: "opt", options: [{ id: "o1", events_option: [{ id: "e", type: "showhide", promoId: "ghost_target" }] }] },
              runtime: {}, events: [], children: [] },
            { id: "sv1", type: "survey", properties: {}, responsive: mkBox(), specials: { field_name: "sv", connectedForm: "missing_field" }, events: [] },
            { id: "b1", type: "button", properties: {}, responsive: mkBox(), specials: { text: "X" },
              events: [{ id: "ev", type: "click", action: "set_field_value", target: "w-nope" }] },
          ],
        },
      ],
    },
  ],
};
const rbb = validatePage(bindingsBad);
check("dup field_name in form warned", rbb.warnings.some((w) => w.includes('field_name "phone_number"') && w.includes("used 2")), rbb.warnings);
check("dangling option promoId warned", rbb.warnings.some((w) => w.includes("promoId") && w.includes("ghost_target")), rbb.warnings);
check("dangling connectedForm warned", rbb.warnings.some((w) => w.includes("connectedForm") && w.includes("missing_field")), rbb.warnings);
check("dangling set_field_value element ref warned", rbb.warnings.some((w) => w.includes("set_field_value") && w.includes("w-nope")), rbb.warnings);

const bindingsGood = {
  page: [
    {
      id: "secg", type: "section",
      properties: { name: "G", movable: false, sync: true },
      responsive: { desktop: { config: {}, styles: { position: "relative", height: 800 } }, mobile: { config: {}, styles: { position: "relative", height: 800 } } },
      specials: {}, runtime: {}, events: [],
      children: [
        {
          id: "frm2", type: "form",
          properties: { name: "Form", movable: true, sync: true },
          responsive: mkBox(), specials: {}, runtime: {}, events: [],
          children: [
            { id: "n1", type: "input", properties: {}, responsive: mkBox(), specials: { field_name: "full_name" }, events: [] },
            { id: "p1", type: "input", properties: {}, responsive: mkBox(), specials: { field_name: "phone_number" }, events: [] },
          ],
        },
      ],
    },
  ],
};
const rbg = validatePage(bindingsGood);
check("clean form has no binding warnings", rbg.warnings.length === 0, rbg.warnings);

console.log("== config: named environment presets (local/staging/prod) ==");
{
  // Deterministic: isolate from any ambient WEBCAKE_* and the saved auth.json on the dev box.
  for (const k of ["WEBCAKE_API_BASE", "WEBCAKE_APP_BASE", "WEBCAKE_BUILDER_BASE", "WEBCAKE_ENV", "WEBCAKE_JWT", "WEBCAKE_ORG_ID"]) delete process.env[k];
  process.env.WEBCAKE_CONFIG_DIR = "/nonexistent/webcake-smoke";
  check("env names are local/staging/prod", setEq(new Set<string>(ENV_NAMES), ["local", "staging", "prod"]), ENV_NAMES);
  check(
    "staging preset resolves to api+app bases",
    resolveEnv("staging")?.apiBase === "https://api.staging.webcake.io" && resolveEnv("staging")?.appBase === "https://staging.webcake.io"
  );
  check("unknown env name → undefined", resolveEnv("bogus") === undefined);
  const prod = readConfig({ env: "prod", jwt: "t" }).config;
  check("readConfig(env=prod) fills api+app base", prod?.base === "https://api.webcake.io" && prod?.appBase === "https://webcake.io", prod);
  const local = readConfig({ env: "local", jwt: "t" }).config;
  check("readConfig(env=local) fills api+app base", local?.base === "http://localhost:5800" && local?.appBase === "http://localhost:5173", local);
  check("explicit base overrides the preset", readConfig({ env: "prod", base: "http://x:1", jwt: "t" }).config?.base === "http://x:1");
  check("unknown env leaves base missing", readConfig({ env: "bogus", jwt: "t" }).missing.includes("WEBCAKE_API_BASE"));

  // builder host for editor/preview URLs (distinct from the api + app bases)
  check("env presets carry builder bases", resolveEnv("prod")?.builderBase === "https://builder.webcake.io" && resolveEnv("local")?.builderBase === "http://builder.localhost:5800");
  check("readConfig(env=prod) sets builderBase", prod?.builderBase === "https://builder.webcake.io", prod);
  check("readConfig(env=local) sets builderBase", local?.builderBase === "http://builder.localhost:5800", local);
  check("readConfig(env=staging) sets builderBase", readConfig({ env: "staging", jwt: "t" }).config?.builderBase === "https://builder.staging.webcake.io");
  check("builderBase derives from a custom api base (api. → builder.)", readConfig({ base: "https://api.example.com", jwt: "t" }).config?.builderBase === "https://builder.example.com");
  check("builderBase derives from a localhost api base", readConfig({ base: "http://localhost:5800", jwt: "t" }).config?.builderBase === "http://builder.localhost:5800");
  check("explicit builderBase overrides the preset", readConfig({ env: "prod", builderBase: "https://b.test", jwt: "t" }).config?.builderBase === "https://b.test");

  // editor/preview link is re-rooted on the builder host, whether the backend
  // returns a path or an absolute URL on its own host.
  const localCfg = readConfig({ env: "local", jwt: "t" }).config!;
  check("editor url from a path → builder host", toEditorUrl(localCfg, "/editor/v2/abc") === "http://builder.localhost:5800/editor/v2/abc");
  check("editor url from an absolute api url → builder host", toEditorUrl(localCfg, "http://localhost:5800/editor/v2/abc?x=1") === "http://builder.localhost:5800/editor/v2/abc?x=1");
  check("editor url passthrough when empty", toEditorUrl(localCfg, undefined) === undefined);
}

console.log("== pexels: key resolution + photo normalization (offline, no network) ==");
{
  for (const k of ["PEXELS_API_KEY"]) delete process.env[k];
  check("no key → undefined", resolvePexelsKey() === undefined);
  check("header key wins (override)", resolvePexelsKey("hdr-key") === "hdr-key");
  process.env.PEXELS_API_KEY = "  env-key  ";
  check("env key is read + trimmed", resolvePexelsKey() === "env-key");
  delete process.env.PEXELS_API_KEY;
  check("x-pexels-key header parsed", pexelsKeyFromHeaders({ "x-pexels-key": "abc" }) === "abc");
  check("array header takes first", pexelsKeyFromHeaders({ "x-pexels-key": ["a", "b"] }) === "a");
  check("absent header → undefined", pexelsKeyFromHeaders({}) === undefined);

  const photo = normalizePhoto({
    id: 42, alt: "a cat", width: 1200, height: 800, avg_color: "#446688",
    photographer: "Jane", photographer_url: "https://pexels.com/@jane", url: "https://pexels.com/photo/42",
    src: { large: "https://images.pexels.com/large.jpg", medium: "https://images.pexels.com/medium.jpg" },
  });
  check("normalizePhoto keeps the page-builder fields", photo.id === 42 && photo.alt === "a cat" && photo.avg_color === "#446688" && photo.src.large.includes("large.jpg") && photo.pexels_url.endsWith("/42"));
  const sparse = normalizePhoto({ id: 1 });
  check("normalizePhoto tolerates missing fields", sparse.alt === "" && sparse.avg_color === null && typeof sparse.src === "object");

  // shared proxy fallback (used when no local key)
  delete process.env.PEXELS_PROXY_BASE;
  check("proxy base defaults to the hosted host", resolvePexelsProxyBase() === PEXELS_PROXY_DEFAULT);
  check("proxy base override wins + trailing slash trimmed", resolvePexelsProxyBase("https://x.test/") === "https://x.test");
  process.env.PEXELS_PROXY_BASE = "https://env.test";
  check("proxy base read from PEXELS_PROXY_BASE env", resolvePexelsProxyBase() === "https://env.test");
  delete process.env.PEXELS_PROXY_BASE;
  const q = buildSearchQuery({ query: "coffee cup", perPage: 3, orientation: "landscape" });
  check("buildSearchQuery encodes query + per_page + orientation", q.get("query") === "coffee cup" && q.get("per_page") === "3" && q.get("orientation") === "landscape");
  check("buildSearchQuery clamps per_page to 1..80", buildSearchQuery({ query: "x", perPage: 999 }).get("per_page") === "80" && buildSearchQuery({ query: "x", perPage: 0 }).get("per_page") === "1");
}

console.log(`\n${failures === 0 ? "ALL GOOD" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
