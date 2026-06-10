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
import { compactSource, deepEq, sparseTemplate } from "./core/compact.js";
import { parseHtml } from "./persistence/html-ingest.js";
import { readConfig, resolveEnv, ENV_NAMES, configFromHeaders } from "./persistence/config.js";
import { toEditorUrl, toPreviewUrl, buildPublishRequestRedacted } from "./persistence/webcake-client.js";
import { normalizePhoto, resolvePexelsKey, pexelsKeyFromHeaders, resolvePexelsProxyBase, buildSearchQuery, PEXELS_PROXY_DEFAULT } from "./persistence/pexels-client.js";
import { putDraft, getDraft, updateDraft, deleteDraft } from "./persistence/draft-cache.js";

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

console.log("== compact: the inverse of expand (round-trip persists the same tree) ==");
{
  const cGood: any = compactSource(good, createElement);
  const cBtn = cGood.page[0].children[0];
  check("compact strips runtime + breakpoint config boilerplate", cBtn.runtime === undefined && cBtn.responsive.desktop.config === undefined, cBtn);
  check("compact keeps real events", Array.isArray(cBtn.events) && cBtn.events.length === 1, cBtn.events);
  check("compact keeps only non-default properties (custom name)", deepEq(cBtn.properties, { name: "CTA" }), cBtn.properties);
  check("compact drops empty popup events/children/specials", cGood.page[1].events === undefined && cGood.page[1].children === undefined && cGood.page[1].specials === undefined, cGood.page[1]);
  check(
    "round-trip: expand(compact(x)) deep-equals expand(x)",
    deepEq(expandSource(cGood, createElement), expandSource(good, createElement))
  );
  const cmpSparse: any = compactSource(exp, createElement); // compact(expand(sparse))
  check(
    "round-trip from sparse: expand(compact(expand(s))) == expand(s)",
    deepEq(expandSource(cmpSparse, createElement), expandSource(sparse, createElement))
  );
  check("compact tolerates unknown types (pass-through)", compactSource({ page: [{ id: "x", type: "nope" }] }, createElement).page[0].id === "x");
}

console.log("== sparseTemplate: the authoring shape get_element/new_element hand out ==");
{
  const tplText = sparseTemplate(createElement("text-block"));
  check("template strips properties/runtime/empty events", tplText.properties === undefined && tplText.runtime === undefined && tplText.events === undefined, tplText);
  check("template keeps seeded styles + specials on BOTH breakpoints", tplText.responsive.desktop.styles.width === 200 && tplText.responsive.mobile.styles.width === 200 && tplText.specials.text === "hello world", tplText);
  check("template drops base config (notloaded/animation)", tplText.responsive.desktop.config === undefined, tplText.responsive.desktop);
  const tplList = sparseTemplate(createElement("list-paragraph"));
  check("template keeps non-default seeded config (list icons)", tplList.responsive.desktop.config?.iconSize === 12, tplList.responsive.desktop.config);
  check("template keeps container children", Array.isArray(sparseTemplate(createElement("form")).children));
  const wrapped = {
    page: [{ id: "tsec", type: "section", responsive: { desktop: { styles: { height: 800 } }, mobile: { styles: { height: 800 } } }, children: [{ ...tplText, id: "ttext" }] }],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  };
  const tr = validatePage(expandSource(wrapped, createElement));
  check("template node expands to a valid page", tr.valid, tr.errors);
}

console.log("== ingest: parseHtml extracts a compact AST ==");
const sampleHtml = `<!DOCTYPE html><html lang="en"><head>
  <title>Brew Coffee</title>
  <meta name="description" content="Best coffee in Hanoi">
  <meta property="og:image" content="https://example.com/og.jpg">
</head><body>
  <header><a href="/">Brew</a><a href="#menu">Menu</a><a href="#order">Order</a></header>
  <section><h1>Welcome to Brew</h1><p>Fresh coffee since 2020.</p><img src="https://x/hero.jpg"><button>Order Now</button></section>
  <section><h2>Why us</h2>
    <div><h3>Premium beans</h3><p>Sourced from Ethiopia.</p></div>
    <div><h3>Roasted daily</h3><p>Fresh every morning.</p></div>
    <div><h3>Local delivery</h3><p>Within 30 minutes.</p></div>
  </section>
  <section><h2>Order Now</h2>
    <form>
      <label for="n">Name</label><input id="n" name="name" required>
      <label for="e">Email</label><input id="e" name="email" type="email" required>
      <button type="submit">Place order</button>
    </form>
  </section>
  <footer><a href="/about">About</a><p>(c) 2024 Brew.</p></footer>
</body></html>`;
const ast = parseHtml(sampleHtml);
check("ingest: title extracted", ast.title === "Brew Coffee", ast.title);
check("ingest: description extracted", ast.description === "Best coffee in Hanoi", ast.description);
check("ingest: og_image extracted", ast.og_image === "https://example.com/og.jpg", ast.og_image);
check("ingest: language extracted", ast.language === "en", ast.language);
check("ingest: at least 4 sections", (ast.sections?.length ?? 0) >= 4, ast.sections?.map((s) => s.role));
const roles = ast.sections.map((s) => s.role);
check("ingest: header detected", roles.includes("header"), roles);
check("ingest: hero detected", roles.includes("hero"), roles);
check("ingest: features detected", roles.includes("features"), roles);
check("ingest: form detected", roles.includes("form"), roles);
check("ingest: footer detected", roles.includes("footer"), roles);
const hero = ast.sections.find((s) => s.role === "hero");
check("ingest: hero heading captured", !!hero?.heading?.includes("Welcome to Brew"), hero);
check("ingest: hero CTA captured", (hero?.ctas?.length ?? 0) > 0, hero?.ctas);
check("ingest: hero image captured", (hero?.images?.length ?? 0) > 0, hero?.images);
const form = ast.sections.find((s) => s.role === "form");
check("ingest: form fields captured", (form?.form_fields?.length ?? 0) >= 2, form?.form_fields);
check("ingest: form submit CTA captured", !!form?.ctas?.[0]?.text?.includes("Place"), form?.ctas);

console.log("== ingest: tolerates empty/CSR-shell HTML ==");
const empty = parseHtml("");
check("ingest: empty input → warning", (empty.warnings?.length ?? 0) > 0, empty.warnings);
const csr = parseHtml(`<html><head><title>SPA</title></head><body><div id="root"></div></body></html>`);
check("ingest: CSR shell → warning", (csr.warnings?.[0] ?? "").includes("client-rendered"), csr.warnings);
check("ingest: CSR shell → title still extracted", csr.title === "SPA", csr.title);

console.log("== library: each (sparse) example expands to a valid element subtree ==");
for (const [type, doc] of Object.entries(LIBRARY)) {
  if (!doc.example) continue;
  // Examples are authored SPARSE (the shape the model should emit), so they go
  // through expand first — the same path validate_page/create_page take.
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
  const rr = validatePage(expandSource(wrapped, createElement));
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
  for (const k of ["WEBCAKE_API_BASE", "WEBCAKE_APP_BASE", "WEBCAKE_BUILDER_BASE", "WEBCAKE_PREVIEW_BASE", "WEBCAKE_ENV", "WEBCAKE_JWT", "WEBCAKE_ORG_ID"]) delete process.env[k];
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

  // The PREVIEW link lives on its own root host (NOT the builder subdomain):
  // preview.localhost:5800 / staging.webcake.me / www.webcake.me.
  check("env presets carry preview bases", resolveEnv("local")?.previewBase === "http://preview.localhost:5800" && resolveEnv("staging")?.previewBase === "https://staging.webcake.me" && resolveEnv("prod")?.previewBase === "https://www.webcake.me");
  check("readConfig(env=local) sets previewBase", localCfg.previewBase === "http://preview.localhost:5800", localCfg);
  check("readConfig(env=prod) sets previewBase", readConfig({ env: "prod", jwt: "t" }).config?.previewBase === "https://www.webcake.me");
  check("previewBase defaults to www.webcake.me without a preset", readConfig({ base: "https://api.example.com", jwt: "t" }).config?.previewBase === "https://www.webcake.me");
  check("explicit previewBase overrides the preset", readConfig({ env: "prod", previewBase: "https://p.test/", jwt: "t" }).config?.previewBase === "https://p.test");
  check("x-webcake-preview-base header parsed", configFromHeaders({ "x-webcake-preview-base": "https://p.example" }).previewBase === "https://p.example");
  check("preview url from a path → preview host (not builder)", toPreviewUrl(localCfg, "/preview/abc") === "http://preview.localhost:5800/preview/abc");
  check("preview url from an absolute api url → preview host", toPreviewUrl(localCfg, "http://localhost:5800/preview/abc?x=1") === "http://preview.localhost:5800/preview/abc?x=1");
  check("preview url passthrough when empty", toPreviewUrl(localCfg, undefined) === undefined);
  check("preview url falls back to builder when previewBase missing", toPreviewUrl({ ...localCfg, previewBase: undefined }, "/preview/abc") === "http://builder.localhost:5800/preview/abc");

  // publish request preview: JWT must be masked everywhere.
  const pub = buildPublishRequestRedacted({ ...localCfg, jwt: "SECRETJWT" }, "pg1", JSON.stringify({ page: [] }), { customDomain: "shop.example.com", customPath: "sale" });
  check("publish request hits the editor publish route on the BUILDER host", pub.url === "http://builder.localhost:5800/api/pages/pg1/edit/publish", pub.url);
  check("publish request masks the JWT", !JSON.stringify(pub).includes("SECRETJWT"), pub);
  check("publish request carries domain/path + source string", pub.body.includes("shop.example.com") && pub.body.includes("custom_path") && pub.body.includes("is_publish"), pub.body);
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

console.log("== draft-cache: page draft round-trip (create_page failure flow) ==");
{
  // Simulate the expanded shell that a failed create_page would cache.
  const pageSource = expandSource(sparse, createElement);
  const draftId = putDraft({ source: pageSource, name: "Test Page", organization_id: "org_1" });
  check("page draft: putDraft returns an id", typeof draftId === "string" && draftId.startsWith("draft_"), draftId);
  const fetched = getDraft(draftId);
  check("page draft: getDraft returns the entry", fetched != null && fetched.name === "Test Page", fetched);
  check("page draft: kind is absent (backward compat)", fetched?.kind == null, fetched?.kind);
  check("page draft: page_id is absent", fetched?.page_id == null, fetched?.page_id);

  // Simulate a patch round: update the cached source.
  const patched = { ...pageSource, page: [...(pageSource.page ?? []), { id: "extra_sec", type: "section" }] };
  updateDraft(draftId, patched);
  const afterPatch = getDraft(draftId);
  check("page draft: updateDraft refreshes source", afterPatch?.source === patched, afterPatch?.source === patched);

  deleteDraft(draftId);
  check("page draft: deleteDraft removes entry", getDraft(draftId) === null, getDraft(draftId));
}

console.log("== draft-cache: sections draft round-trip (add_section dry_run / failure flow) ==");
{
  // Build a minimal expandedShell as add_section would — just the sections array.
  const secShell = expandSource({
    page: [{
      id: "new_sec",
      type: "section",
      responsive: { desktop: { styles: { height: 400 } }, mobile: { styles: { height: 400 } } },
      children: [],
    }],
    popup: [],
    dynamic_pages: [],
    settings: {},
    options: { mobileOnly: false, versionID: null },
    cartConfigs: { isActive: false },
    svariations: [],
  }, createElement);

  const sid = putDraft({ source: secShell, kind: "sections", page_id: "pg_live_123" });
  check("sections draft: putDraft returns an id", typeof sid === "string" && sid.startsWith("draft_"), sid);

  const sd = getDraft(sid);
  check("sections draft: getDraft returns entry with kind='sections'", sd?.kind === "sections", sd?.kind);
  check("sections draft: page_id stored", sd?.page_id === "pg_live_123", sd?.page_id);
  check("sections draft: source has page array", Array.isArray(sd?.source?.page), sd?.source?.page);

  // Simulate patch round: fix an element in the shell then update.
  const fixedShell = { ...secShell, page: secShell.page ?? [] };
  updateDraft(sid, fixedShell);
  const afterFix = getDraft(sid);
  check("sections draft: updateDraft refreshes source", afterFix?.source === fixedShell, afterFix?.source === fixedShell);
  check("sections draft: kind preserved after update", afterFix?.kind === "sections", afterFix?.kind);
  check("sections draft: page_id preserved after update", afterFix?.page_id === "pg_live_123", afterFix?.page_id);

  // Validate the shell — it should pass (well-formed section).
  const shellValid = validatePage(expandSource(secShell, createElement));
  check("sections draft: expanded shell validates", shellValid.valid, shellValid.errors);

  // Simulate the patch_page sections path: ops would be applied, then append would fire.
  // We only test the cache mechanics here (no live network in smoke).
  deleteDraft(sid);
  check("sections draft: deleteDraft removes entry", getDraft(sid) === null, getDraft(sid));

  // Expired / missing draft returns null.
  check("sections draft: getDraft on unknown id → null", getDraft("draft_doesnotexist") === null);
}

console.log("== draft-cache: update draft round-trip (update_page / live-page patch timeout flow) ==");
{
  // Simulate the expanded full-page source as update_page or patch_page (live) would cache.
  const updateSource = expandSource(sparse, createElement);

  // putDraft with kind='update' and an explicit page_id.
  const uid = putDraft({ source: updateSource, kind: "update", page_id: "pg_existing_456" });
  check("update draft: putDraft returns an id", typeof uid === "string" && uid.startsWith("draft_"), uid);

  const ud = getDraft(uid);
  check("update draft: getDraft returns entry with kind='update'", ud?.kind === "update", ud?.kind);
  check("update draft: page_id stored", ud?.page_id === "pg_existing_456", ud?.page_id);
  check("update draft: source has page array", Array.isArray(ud?.source?.page), ud?.source?.page);
  check("update draft: no name (not a new page)", ud?.name == null, ud?.name);

  // Simulate a patch round: getDraft returns a LIVE reference; mutating it is the
  // retry trap — we verify that updateDraft replaces the reference explicitly.
  const mutatedSource = { ...updateSource, page: updateSource.page ?? [] };
  updateDraft(uid, mutatedSource);
  const afterPatch = getDraft(uid);
  check("update draft: updateDraft refreshes source", afterPatch?.source === mutatedSource, afterPatch?.source === mutatedSource);
  check("update draft: kind preserved after update", afterPatch?.kind === "update", afterPatch?.kind);
  check("update draft: page_id preserved after update", afterPatch?.page_id === "pg_existing_456", afterPatch?.page_id);

  // Commit-as-is semantics: expand + validate the draft source (no ops applied) —
  // this mirrors what patch_page({ draft_id, dry_run:false }) does with empty patches.
  const expandedForCommit = expandSource(ud!.source, createElement);
  const commitValid = validatePage(expandedForCommit);
  check("update draft: commit-as-is (no ops) expanded source validates", commitValid.valid, commitValid.errors);

  // Verify different draft IDs are independent (no cross-contamination).
  const uid2 = putDraft({ source: { page: [] }, kind: "update", page_id: "pg_other_789" });
  check("update draft: second update draft has independent id", uid2 !== uid, { uid, uid2 });
  check("update draft: second draft has its own page_id", getDraft(uid2)?.page_id === "pg_other_789");
  deleteDraft(uid2);

  deleteDraft(uid);
  check("update draft: deleteDraft removes entry", getDraft(uid) === null, getDraft(uid));
}

console.log("== validate: animation contract checks ==");
{
  const mkSec = (children: any[]) => ({
    id: "anim_sec",
    type: "section",
    properties: { name: "S", movable: false, sync: true },
    responsive: {
      desktop: { config: {}, styles: { position: "relative", height: 800, background: "rgba(255,255,255,1)" } },
      mobile:  { config: {}, styles: { position: "relative", height: 800, background: "rgba(255,255,255,1)" } },
    },
    specials: {}, runtime: {}, events: [],
    children,
  });
  const mkEl = (id: string, type: string, animName: string, bp: "desktop" | "mobile" | "both" = "both") => ({
    id,
    type,
    properties: { name: "el", movable: true, sync: true },
    responsive: {
      desktop: {
        config: bp === "mobile" ? {} : { animation: { name: animName, delay: 0, duration: 3, repeat: null } },
        styles: { top: 10, left: 10, width: 100, height: 40 },
      },
      mobile: {
        config: bp === "desktop" ? {} : { animation: { name: animName, delay: 0, duration: 3, repeat: null } },
        styles: { top: 10, left: 10, width: 100, height: 40 },
      },
    },
    specials: type === "button" ? { text: "X" } : type === "text-block" ? { text: "X" } : {},
    runtime: {}, events: [],
  });

  // 1) non-animatable type (form) with a real animation name → ERROR
  const rForm = validatePage({
    page: [mkSec([mkEl("f1", "form", "fadeInUp")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("anim: non-animatable type (form) fadeInUp → error", rForm.errors.some((e) => e.includes("cannot animate") && e.includes("form")), rForm.errors);

  // 2) bogus animation name on a text-block → ERROR
  const rBogus = validatePage({
    page: [mkSec([mkEl("t1", "text-block", "fade-in-up")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("anim: bogus name 'fade-in-up' on text-block → error", rBogus.errors.some((e) => e.includes('"fade-in-up"') && e.includes("not in the editor")), rBogus.errors);

  // 3) non-animatable type (html-box) with bogus name → BOTH errors
  const rHtmlBad = validatePage({
    page: [mkSec([mkEl("h1", "html-box", "fade-in-up")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("anim: html-box + bogus name → type error present", rHtmlBad.errors.some((e) => e.includes("cannot animate") && e.includes("html-box")), rHtmlBad.errors);
  check("anim: html-box + bogus name → name error present", rHtmlBad.errors.some((e) => e.includes('"fade-in-up"')), rHtmlBad.errors);

  // 4) valid name on animatable type → NO animation error
  const rGood = validatePage({
    page: [mkSec([mkEl("t2", "text-block", "fadeInUp")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("anim: valid 'fadeInUp' on text-block → no animation error", !rGood.errors.some((e) => e.includes("animate") || e.includes("keyframe")), rGood.errors);

  // 5) name 'none' on any type → no error at all
  const rNone = validatePage({
    page: [mkSec([mkEl("f2", "form", "none")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("anim: name='none' on form → no animation error", !rNone.errors.some((e) => e.includes("animate")), rNone.errors);

  // 6) absent animation object → no error
  const rNoAnim = validatePage({
    page: [mkSec([{
      id: "f3", type: "form",
      properties: { name: "el", movable: true, sync: true },
      responsive: {
        desktop: { config: {}, styles: { top: 10, left: 10, width: 100, height: 40 } },
        mobile:  { config: {}, styles: { top: 10, left: 10, width: 100, height: 40 } },
      },
      specials: {}, runtime: {}, events: [], children: [],
    }])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("anim: absent animation config on form → no animation error", !rNoAnim.errors.some((e) => e.includes("animate")), rNoAnim.errors);

  // 7) styles.opacity 0.4 (number) → WARNING
  const mkOpacity = (id: string, type: string, opacity: unknown) => ({
    id,
    type,
    properties: { name: "el", movable: true, sync: true },
    responsive: {
      desktop: { config: {}, styles: { top: 10, left: 10, width: 100, height: 40, opacity } },
      mobile:  { config: {}, styles: { top: 10, left: 10, width: 100, height: 40 } },
    },
    specials: type === "button" ? { text: "X" } : {},
    runtime: {}, events: [],
  });
  const rOp04 = validatePage({
    page: [mkSec([mkOpacity("b1", "button", 0.4)])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("opacity: 0.4 number → warning present", rOp04.warnings.some((w) => w.includes("opacity=0.4") && w.includes("permanently faded")), rOp04.warnings);

  // 8) styles.opacity "0.4" (numeric string) → WARNING
  const rOpStr = validatePage({
    page: [mkSec([mkOpacity("b2", "button", "0.4")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("opacity: '0.4' string → warning present", rOpStr.warnings.some((w) => w.includes("opacity=0.4") && w.includes("permanently faded")), rOpStr.warnings);

  // 9) styles.opacity 1 → NO warning
  const rOp1 = validatePage({
    page: [mkSec([mkOpacity("b3", "button", 1)])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("opacity: 1 → no opacity warning", !rOp1.warnings.some((w) => w.includes("permanently faded")), rOp1.warnings);

  // 10) non-numeric opacity (e.g. "inherit") → NO warning (schema territory)
  const rOpStr2 = validatePage({
    page: [mkSec([mkOpacity("b4", "button", "inherit")])],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check("opacity: 'inherit' string → no opacity warning", !rOpStr2.warnings.some((w) => w.includes("permanently faded")), rOpStr2.warnings);
}

console.log(`\n${failures === 0 ? "ALL GOOD" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
