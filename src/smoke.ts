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
import { landingDomain } from "./domains/landing/index.js";
import { validatePage, pageSchema } from "./domains/landing/validate.js";
import { expandSource } from "./core/expand.js";
import { compactSource, deepEq, sparseTemplate } from "./core/compact.js";
import { parseHtml, extractTailwindConfig } from "./persistence/html-ingest.js";
import { warningsField } from "./mcp/response.js";
import { readConfig, resolveEnv, ENV_NAMES, configFromHeaders } from "./persistence/config.js";
import { toEditorUrl, toEditorLoginUrl, toPreviewUrl, buildPublishRequestRedacted } from "./persistence/webcake-client.js";
import { normalizePhoto, resolvePexelsKey, pexelsKeyFromHeaders, resolvePexelsProxyBase, buildSearchQuery, PEXELS_PROXY_DEFAULT } from "./persistence/pexels-client.js";
import { putDraft, getDraft, updateDraft, deleteDraft } from "./persistence/draft-cache.js";
import { buildConnectUrl, parseCallback } from "./auth/login.js";
import { isLocalPath, resolveLocalPath, sniffMime, localContentType } from "./tools/media.js";
import { iconifyCandidates } from "./persistence/icon-client.js";
import { collectExternalImageUrls, rewriteImageUrls, isRehostableImageUrl } from "./persistence/rehost.js";

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

console.log("== validate: schema errors name the element id + offending key ==");
{
  // A stray key directly under responsive.<bp> is the classic schema error a
  // model cannot act on from the positional path alone — the message must name
  // the element id, the stray key, and the only op that can delete it (replace).
  const strayed = structuredClone(good) as any;
  strayed.page[0].children[0].responsive.desktop.zoomy = 1;
  const rs = validatePage(strayed);
  check("stray key fails schema", !rs.valid, rs);
  const schemaErr = rs.errors.find((e) => e.includes("additional properties")) ?? "";
  check("schema error names the offending key", schemaErr.includes('offending key: "zoomy"'), schemaErr);
  check("schema error names the element id", schemaErr.includes('element id="btn1"'), schemaErr);
  check("schema error prescribes op:'replace'", schemaErr.includes("op:'replace'") && schemaErr.includes("cannot delete"), schemaErr);
  // A bad enum value reports what was actually there.
  const badType = structuredClone(good) as any;
  badType.page[0].children[0].type = "txt-block";
  const rt = validatePage(badType);
  const enumErr = rt.errors.find((e) => e.includes("got:")) ?? "";
  check("enum error reports the bad value + element id", enumErr.includes('"txt-block"') && enumErr.includes('element id="btn1"'), rt.errors);
}

console.log("== expand: relocates misplaced responsive.<bp>.animation into config ==");
{
  // Models regularly emit animation at the breakpoint level (schema error a
  // patch update can never fix) — domain.expand moves it where the editor
  // reads it, so the page validates on the FIRST create_page.
  const misplaced = structuredClone(good) as any;
  misplaced.page[0].children[0].responsive.desktop.animation = { name: "fadeInUp", delay: 0, duration: 2, repeat: null };
  const fixed = landingDomain.expand(misplaced) as any;
  const bp = fixed.page[0].children[0].responsive.desktop;
  check("stray animation key removed", bp.animation === undefined, bp);
  check("animation moved into config", bp.config?.animation?.name === "fadeInUp" && bp.config?.animation?.duration === 2, bp.config);
  check("relocated page validates", validatePage(fixed).valid, validatePage(fixed).errors);
  // An explicit non-'none' config.animation wins over the stray key.
  const both = structuredClone(good) as any;
  both.page[0].children[0].responsive.desktop.animation = { name: "fadeInUp" };
  both.page[0].children[0].responsive.desktop.config.animation = { name: "zoomIn", delay: 1, duration: 4, repeat: null };
  const kept = (landingDomain.expand(both) as any).page[0].children[0].responsive.desktop;
  check("explicit config.animation wins over the stray key", kept.config.animation.name === "zoomIn" && kept.animation === undefined, kept.config);
}

console.log("== validate: accepts JSON string input ==");
const r3 = validatePage(JSON.stringify(good));
check("string input parsed & valid", r3.valid, r3.errors);

console.log("== canvas width is a CHOICE (settings.width_section 960|1200 / 420|360) ==");
{
  // createPageSource sets the chosen width up front.
  const wide = landingDomain.createPageSource({ settings: { width_section: { desktop: 1200, mobile: 360 } } }) as any;
  check("width: createPageSource honors width_section override", wide.settings.width_section.desktop === 1200 && wide.settings.width_section.mobile === 360, wide.settings.width_section);

  // An element at left:1000 width:180 (right edge 1180) overflows a 960 canvas but FITS a 1200 canvas.
  const mk = (deskW: number) => {
    const p = JSON.parse(JSON.stringify(good));
    p.settings.width_section = { desktop: deskW, mobile: 420 };
    p.page[0].children[0].responsive.desktop.styles = { top: 100, left: 1000, width: 180, height: 44 };
    return p;
  };
  const at960 = validatePage(mk(960));
  check("width: overflow flagged against the 960 canvas", at960.warnings.some((w) => /exceeds canvas 960/.test(w)), at960.warnings);
  const at1200 = validatePage(mk(1200));
  check("width: SAME element fits the 1200 canvas (no overflow warning)", !at1200.warnings.some((w) => /exceeds canvas/.test(w)), at1200.warnings);
  check("width: 1200 canvas page is valid", at1200.valid, at1200.errors);

  // Only the editor-allowed widths pass — a stray width is a schema error.
  const badW = JSON.parse(JSON.stringify(good));
  badW.settings.width_section = { desktop: 1000, mobile: 420 };
  check("width: non-allowed desktop width (1000) rejected by schema enum", !validatePage(badW).valid, validatePage(badW).errors);
}

console.log("== validate: custom CSS/class/JS escape hatches (beyond-element capability) ==");
{
  const clone = () => JSON.parse(JSON.stringify(good));
  // Proper usage: customAdvance + declarations-only custom_css + page settings.extra_css/script → valid, no escape-hatch warnings.
  const okPage = clone();
  okPage.page[0].children[0].specials = { text: "CTA", customAdvance: true, custom_css: "background:linear-gradient(to right,#0058bc,#0070eb);box-shadow:0 20px 40px rgba(0,0,0,.08);", custom_class: "cta-pill,glow" };
  okPage.settings.extra_css = "#w-btn1{transition:transform .3s}#w-btn1:hover{transform:scale(1.05)}";
  okPage.settings.extra_script = "console.log('hi')";
  okPage.settings.bhet = "<link href='https://fonts.googleapis.com/css2?family=Inter&display=swap' rel='stylesheet'>";
  okPage.settings.bbet = "<script src='https://widget.example.com/chat.js'></script>";
  const okR = validatePage(okPage);
  check("escape hatch: valid page with custom_css/class + extra_css/script + bhet/bbet passes", okR.valid, okR.errors);
  check("escape hatch: no false warning when used correctly", !okR.warnings.some((w) => /custom_css|customAdvance/.test(w)), okR.warnings.filter((w) => /custom_css|customAdvance/.test(w)));

  // custom_css set but customAdvance missing → silent no-op warning.
  const noAdvance = clone();
  noAdvance.page[0].children[0].specials = { text: "CTA", custom_css: "box-shadow:0 2px 8px rgba(0,0,0,.1);" };
  const naR = validatePage(noAdvance);
  check("escape hatch: warns custom_css without customAdvance", naR.warnings.some((w) => /customAdvance!==true/.test(w)), naR.warnings);

  // custom_css containing a selector/:hover → declarations-only warning.
  const selInCss = clone();
  selInCss.page[0].children[0].specials = { text: "CTA", customAdvance: true, custom_css: "#w-btn1:hover{transform:scale(1.1)}" };
  const selR = validatePage(selInCss);
  check("escape hatch: warns selector/:hover inside custom_css", selR.warnings.some((w) => /declarations inside/.test(w)), selR.warnings);
  check("escape hatch: declarations-only misuse does NOT block (warning, not error)", selR.valid, selR.errors);
}

console.log("== validate: custom-code SAFETY (broad/broken custom breaks the UI) ==");
{
  const cloneG = () => JSON.parse(JSON.stringify(good));
  const W = (r: any, re: RegExp) => r.warnings.filter((w: string) => re.test(w));
  // settings.extra_css with bare-tag + Webcake-internal selectors → unscoped warning; scoped #w- rule does NOT trip it.
  const broad = cloneG();
  broad.settings.extra_css = "body{margin:0} .rectangle-css{opacity:.5} #w-btn1:hover{transform:scale(1.02)}";
  const broadR = validatePage(broad);
  check("custom-safety: unscoped extra_css selectors (body/.rectangle-css) flagged", W(broadR, /UNSCOPED selector/).length > 0, broadR.warnings);
  check("custom-safety: a #w- scoped rule is NOT flagged", !/#w-btn1/.test(W(broadR, /UNSCOPED selector/)[0] ?? ""), W(broadR, /UNSCOPED/));
  // unbalanced braces in extra_css.
  const braces = cloneG(); braces.settings.extra_css = "#w-btn1{color:red";
  check("custom-safety: unbalanced extra_css braces flagged", W(validatePage(braces), /unbalanced braces/).length > 0);
  // bhet holding raw CSS (no tags) → wrong-field warning.
  const bhetCss = cloneG(); bhetCss.settings.bhet = "body{margin:0}";
  check("custom-safety: bhet with no HTML tags flagged (belongs in extra_css)", W(validatePage(bhetCss), /no HTML tags/).length > 0);
  // bbet with an unclosed <script> → swallow warning.
  const bbetBad = cloneG(); bbetBad.settings.bbet = "<script>init()";
  check("custom-safety: bbet unclosed <script> flagged", W(validatePage(bbetBad), /unbalanced <script>/).length > 0);
  // element custom_css with layout props → break-layout warning (visual props alone do NOT trip it).
  const layoutCss = cloneG();
  layoutCss.page[0].children[0].specials = { text: "X", customAdvance: true, custom_css: "width:100%;display:flex;box-shadow:0 2px 8px rgba(0,0,0,.1);" };
  check("custom-safety: custom_css layout props (width/display) flagged", W(validatePage(layoutCss), /layout prop/).length > 0, validatePage(layoutCss).warnings);
  const visualCss = cloneG();
  visualCss.page[0].children[0].specials = { text: "X", customAdvance: true, custom_css: "box-shadow:0 2px 8px rgba(0,0,0,.1);backdrop-filter:blur(8px);" };
  check("custom-safety: visual-only custom_css is NOT flagged", W(validatePage(visualCss), /layout prop/).length === 0, validatePage(visualCss).warnings);
  // a correct, fully-scoped custom setup → none of these warnings.
  const clean = cloneG();
  clean.settings.extra_css = "#w-btn1{transition:transform .3s}#w-btn1:hover{transform:translateY(-2px)}";
  clean.settings.bhet = "<link href='https://fonts.googleapis.com/css2?family=Inter' rel='stylesheet'>";
  clean.page[0].children[0].specials = { text: "X", customAdvance: true, custom_css: "box-shadow:0 8px 24px rgba(0,0,0,.08);" };
  check("custom-safety: correctly-scoped custom triggers no safety warning", W(validatePage(clean), /UNSCOPED|unbalanced|no HTML tags|layout prop/).length === 0, validatePage(clean).warnings);
}

console.log("== validate: icon rendering (svg-mask needs background; font-class route is clean) ==");
{
  const cloneG = () => JSON.parse(JSON.stringify(good));
  const maskChild = (bg?: string) => ({
    id: "icon1", type: "rectangle", properties: { name: "icon", movable: true, sync: true },
    specials: {}, runtime: {}, events: [],
    responsive: {
      desktop: { config: { svgMask: "<svg viewBox='0 0 24 24'><path d='M4 4h16v16H4z'/></svg>" }, styles: { top: 10, left: 10, width: 40, height: 40, ...(bg ? { background: bg } : {}) } },
      mobile: { config: { svgMask: "<svg viewBox='0 0 24 24'><path d='M4 4h16v16H4z'/></svg>" }, styles: { top: 10, left: 10, width: 40, height: 40, ...(bg ? { background: bg } : {}) } },
    },
  });
  // svg-mask WITHOUT a background fill → invisible-icon warning (the "svg in a rectangle doesn't show" bug).
  const noBg = cloneG(); noBg.page[0].children = [maskChild()];
  check("icon-render: svg-mask rectangle without background → invisible warning", validatePage(noBg).warnings.some((w) => /svgMask is set but styles\.background/.test(w)), validatePage(noBg).warnings);
  // svg-mask WITH a solid background → no invisible warning.
  const withBg = cloneG(); withBg.page[0].children = [maskChild("rgba(0,88,188,1)")];
  check("icon-render: svg-mask rectangle WITH background → no invisible warning", !validatePage(withBg).warnings.some((w) => /svgMask is set but styles\.background/.test(w)), validatePage(withBg).warnings);
  // font-class route (the Stitch-faithful one): text-block with a Material Symbols span + the font loaded via bhet → valid & clean.
  const fontRoute = cloneG();
  fontRoute.settings.bhet = "<link href='https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined' rel='stylesheet'>";
  fontRoute.page[0].children = [{
    id: "icon2", type: "text-block", properties: { name: "icon", movable: true, sync: true },
    specials: { text: "<span class=\"material-symbols-outlined\">verified</span>" }, runtime: {}, events: [],
    responsive: {
      desktop: { config: {}, styles: { top: 10, left: 10, width: 40, height: 40, fontSize: 32, color: "rgba(0,88,188,1)" } },
      mobile: { config: {}, styles: { top: 10, left: 10, width: 40, height: 40, fontSize: 28, color: "rgba(0,88,188,1)" } },
    },
  }];
  const fr = validatePage(fontRoute);
  check("icon-render: font-class text-block icon validates clean (no svg/emoji warning)", fr.valid && !fr.warnings.some((w) => /svgMask|emoji/.test(w)), { errors: fr.errors, warnings: fr.warnings });
}

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

console.log("== ingest: Stitch-structure section classification (generalizes to any Stitch HTML) ==");
{
  // Mirrors the real Stitch shape: <nav> top bar (no <header>), <main> with a
  // h1 hero, 2-column card grids, a card-less CTA band, <footer>, and a sticky
  // BOTTOM <nav> action bar.
  const stitchStruct = `<!DOCTYPE html><html><head></head><body>
    <nav class="fixed top-0 w-full z-50 bg-white/80"><div class="font-bold">BrandName</div><div><a href="#">Pricing</a><a href="#">Docs</a></div><a class="px-5 py-2 rounded-xl bg-primary" href="#">Sign in</a></nav>
    <main class="pt-20">
      <section class="pt-24 pb-32"><div class="grid lg:grid-cols-12"><div class="lg:col-span-7"><h1>Become a strategic partner</h1><p>Earn recurring commission on every customer you refer to us.</p><a class="px-8 py-4 rounded-xl bg-primary" href="#">Join now</a></div><div class="lg:col-span-5"><img src="https://x/hero.jpg"/></div></div></section>
      <section class="py-24 bg-surface-container-low"><div class="text-center"><h2>Transparent income</h2></div><div class="grid md:grid-cols-2 gap-6"><div class="card p-8 rounded-xl"><span class="material-symbols-outlined">payments</span><h3>Fast payouts</h3><p>Money in your account within days, not months at all.</p></div><div class="card p-8 rounded-xl"><span class="material-symbols-outlined">monitoring</span><h3>Live tracking</h3><p>Watch every referral convert in a real-time dashboard.</p></div></div></section>
      <section class="py-20"><div class="rounded-3xl p-12 text-center"><h2>Ready to boost your income?</h2><p>Join thousands of partners already earning with us.</p><p>No setup fee, cancel anytime, get started in minutes.</p><a class="px-8 py-4 rounded-xl bg-primary" href="#">Get started</a></div></section>
    </main>
    <footer class="pt-12 pb-8"><div class="grid grid-cols-4"><a href="#">About</a><a href="#">Blog</a><a href="#">Terms</a><a href="#">Contact</a></div><p>© 2026 BrandName</p></footer>
    <nav class="fixed bottom-0 left-0 right-0 z-50 bg-white"><a class="px-6 py-3 rounded-xl bg-primary" href="#">Join now</a></nav>
  </body></html>`;
  const ss = parseHtml(stitchStruct, "full");
  const roles = ss.sections.map((s) => s.role);
  check("stitch-struct: <nav> top bar (no <header>) → header", roles[0] === "header", roles);
  check("stitch-struct: h1 section → hero", ss.sections.some((s) => s.role === "hero" && /strategic partner/.test(s.heading ?? "")), roles);
  check("stitch-struct: 2-card grid → features (not unknown)", ss.sections.some((s) => s.role === "features" && (s.blocks?.length ?? 0) === 2), roles);
  check("stitch-struct: card-less CTA band with 2 paragraphs → cta (not unknown)", ss.sections.some((s) => s.role === "cta" && /Ready to boost/.test(s.heading ?? "")), roles);
  check("stitch-struct: <footer> → footer", roles.includes("footer"), roles);
  check("stitch-struct: sticky BOTTOM <nav> is NOT a second header", roles.filter((r) => r === "header").length === 1, roles);
  check("stitch-struct: no 'unknown' sections left", !roles.includes("unknown"), roles);
}

console.log("== ingest: size_hint (desktop section heights) ==");
check("ingest: every section has a size_hint", ast.sections.every((s) => (s.size_hint?.height ?? 0) > 0), ast.sections.map((s) => s.size_hint));
const headerHint = ast.sections.find((s) => s.role === "header")?.size_hint;
check("ingest: header size_hint is a slim bar", !!headerHint && headerHint.height <= 120, headerHint);
const heroHint = ast.sections.find((s) => s.role === "hero")?.size_hint;
check("ingest: hero size_hint is a tall band", !!heroHint && heroHint.height >= 400, heroHint);
const footerHint = ast.sections.find((s) => s.role === "footer")?.size_hint;
check("ingest: footer size_hint shorter than hero", !!footerHint && !!heroHint && footerHint.height < heroHint.height, { footerHint, heroHint });
const cssHintHtml = `<!DOCTYPE html><html><head><style>
  .hero { min-height: 100vh; }
  #promo { height: 560px; }
</style></head><body>
  <section class="hero"><h1>Big hero</h1><p>Tagline goes here for the hero band.</p><button>Go</button></section>
  <section id="promo"><h2>Promo</h2><p>Limited time offer on all plans this week.</p><button>Claim</button></section>
  <section style="min-height: 75vh"><h2>Inline</h2><p>Inline-styled band with its own height.</p></section>
</body></html>`;
const cssAst = parseHtml(cssHintHtml);
const cssHints = cssAst.sections.map((s) => s.size_hint);
check("ingest: 100vh class rule → css basis ~800px", cssHints[0]?.basis === "css" && cssHints[0]?.height === 800 && cssHints[0]?.css === "100vh", cssHints[0]);
check("ingest: explicit px height by #id → css basis exact", cssHints[1]?.basis === "css" && cssHints[1]?.height === 560, cssHints[1]);
check("ingest: inline min-height vh → css basis", cssHints[2]?.basis === "css" && cssHints[2]?.height === 600, cssHints[2]);
check("ingest: .hero rule does not leak into #promo", cssHints[1]?.css !== "100vh", cssHints[1]);

console.log("== ingest: tolerates empty/CSR-shell HTML ==");
const empty = parseHtml("");
check("ingest: empty input → warning", (empty.warnings?.length ?? 0) > 0, empty.warnings);
const csr = parseHtml(`<html><head><title>SPA</title></head><body><div id="root"></div></body></html>`);
check("ingest: CSR shell → warning", (csr.warnings?.[0] ?? "").includes("client-rendered"), csr.warnings);
check("ingest: CSR shell → title still extracted", csr.title === "SPA", csr.title);

console.log("== ingest: stylesheet extraction (palette, background_images, fonts) ==");
const stylesheetHtml = `<!DOCTYPE html><html lang="en"><head>
  <title>Style Test</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&family=Playfair+Display&display=swap">
  <style>
    :root {
      --primary: #0A7C6E;
      --gold: #C9A84C;
      --navy: #0D2D3A;
      --not-a-color: 42px;
    }
    .hero {
      background: url(https://example.com/hero-bg.jpg) center/cover;
      font-family: 'Poppins', sans-serif;
      color: rgba(13,45,58,1);
    }
    .cta { background: linear-gradient(135deg, #0A7C6E, #C9A84C); }
    .card { background: url(https://example.com/card-bg.png); }
  </style>
</head><body>
  <section><h1>Hello</h1><p>Welcome to our site. We build things that matter.</p><button>Get started</button></section>
  <section>
    <h2>Features</h2>
    <div><h3>Speed</h3><p>Fast as lightning.</p></div>
    <div><h3>Scale</h3><p>Grows with you.</p></div>
    <div><h3>Security</h3><p>Always protected.</p></div>
  </section>
</body></html>`;
const ssAst = parseHtml(stylesheetHtml, "compact");
check("ingest: CSS var palette extracted (compact)", ssAst.palette?.["primary"] === "#0A7C6E", ssAst.palette);
check("ingest: CSS var palette gold extracted", ssAst.palette?.["gold"] === "#C9A84C", ssAst.palette);
check("ingest: non-color CSS var excluded from palette", ssAst.palette?.["not-a-color"] === undefined, ssAst.palette);
check("ingest: background_images from stylesheet extracted", (ssAst.background_images?.length ?? 0) >= 1, ssAst.background_images);
check("ingest: hero bg image URL captured", ssAst.background_images?.some((u) => u.includes("hero-bg.jpg")) === true, ssAst.background_images);
check("ingest: Google Font extracted into fonts", ssAst.fonts?.some((f) => f.toLowerCase().includes("poppins")) === true, ssAst.fonts);
check("ingest: stylesheet colors merged into colors", (ssAst.colors?.length ?? 0) > 0, ssAst.colors);

console.log("== ingest: Tailwind-config design system (Google Stitch / Tailwind-CDN) ==");
// Stitch puts the WHOLE design system in tailwind.config (NOT in CSS) and wraps
// content sections in <main> with <header>/<footer> as siblings.
const stitchHtml = `<!DOCTYPE html><html lang="vi"><head>
  <title>Little Posh</title>
  <script src="https://cdn.tailwindcss.com?plugins=forms"></script>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300..700&family=Source+Sans+3&display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&display=swap" rel="stylesheet"/>
  <script id="tailwind-config">
    tailwind.config = { theme: { extend: {
      "colors": { "primary": "#a43b38", "secondary": "#735c00", "surface-container-low": "#f3f3f3", "on-surface-variant": "#574240", "secondary-container": "#fcd664" },
      "borderRadius": { "DEFAULT": "1rem", "lg": "2rem", "full": "9999px" },
      "spacing": { "xl": "80px", "lg": "48px", "gutter": "24px", "margin-desktop": "40px" },
      "fontFamily": { "display-lg": ["Quicksand"], "body-md": ["Source Sans 3"] },
      "fontSize": { "display-lg": ["48px", {"lineHeight": "56px", "fontWeight": "700"}], "label-sm": ["12px", {"lineHeight": "16px"}] }
    } } }
  </script>
  <style>body { background-color: #f9f9f9; }</style>
</head><body class="font-body-md text-on-surface">
  <header class="sticky top-0"><a class="text-primary" href="#">Little Posh</a><nav><a class="text-on-surface-variant" href="#">New In</a><a class="text-on-surface-variant" href="#">Sale</a></nav></header>
  <main>
    <section class="relative bg-surface-container-low"><img src="https://x/hero.jpg" alt="hero"/><h1 class="text-primary">Nơi Phong Cách</h1><p>Thời trang trẻ em cao cấp cho bé yêu.</p><a class="bg-primary" href="#shop">Mua Ngay</a></section>
    <section><h2 class="text-primary">Ưu Đãi Chớp Nhoáng</h2>
      <div class="group"><img src="https://x/p1.jpg"/><h3>Váy Xòe Pastel</h3><p class="text-primary">450.000đ</p></div>
      <div class="group"><img src="https://x/p2.jpg"/><h3>Set Đồ Ngôi Sao</h3><p class="text-primary">380.000đ</p></div>
      <div class="group"><img src="https://x/p3.jpg"/><h3>Mũ Cói Vành Rộng</h3><p class="text-primary">195.000đ</p></div>
    </section>
    <section><h2 class="text-primary">Đăng Ký Nhận Ưu Đãi</h2>
      <form><input name="name" placeholder="Họ và tên"/><input name="email" type="email" placeholder="Email"/><button type="submit" class="bg-primary">Đăng Ký Ngay</button></form>
    </section>
  </main>
  <footer class="bg-surface-container-low"><h2 class="text-secondary">Little Posh</h2><a href="#">Về Chúng Tôi</a></footer>
</body></html>`;
const tw = parseHtml(stitchHtml, "compact");
check("stitch: tailwind config palette extracted by token", tw.palette?.["primary"] === "#a43b38" && tw.palette?.["secondary-container"] === "#fcd664", tw.palette);
check("stitch: design_tokens.spacing resolved to px", tw.design_tokens?.spacing?.["xl"] === "80px" && tw.design_tokens?.spacing?.["gutter"] === "24px", tw.design_tokens?.spacing);
check("stitch: design_tokens.font_size resolved to px (array value, nested keys skipped)", tw.design_tokens?.font_size?.["display-lg"] === "48px" && tw.design_tokens?.font_size?.["label-sm"] === "12px", tw.design_tokens?.font_size);
check("stitch: design_tokens.radius extracted", tw.design_tokens?.radius?.["full"] === "9999px", tw.design_tokens?.radius);
check("stitch: design_tokens.font_family first family of array", tw.design_tokens?.font_family?.["display-lg"] === "Quicksand", tw.design_tokens?.font_family);
check("stitch: colors usage-ranked from utility classes (primary on top)", tw.colors?.[0] === "#a43b38", tw.colors);
check("stitch: icon webfont (Material Symbols) excluded from fonts", !(tw.fonts ?? []).some((f) => /material symbols/i.test(f)), tw.fonts);
check("stitch: content fonts kept (Quicksand + Source Sans 3)", (tw.fonts ?? []).some((f) => /quicksand/i.test(f)) && (tw.fonts ?? []).some((f) => /source sans/i.test(f)), tw.fonts);
const twRoles = tw.sections.map((s) => s.role);
check("stitch: <main> flattened — sections NOT collapsed (>=5)", tw.sections.length >= 5, twRoles);
check("stitch: header + footer survive <main> flattening", twRoles.includes("header") && twRoles.includes("footer"), twRoles);
check("stitch: hero inside <main> detected", twRoles.includes("hero"), twRoles);
check("stitch: form inside <main> detected", twRoles.includes("form"), twRoles);
// A page with NO tailwind config must not gain design_tokens (no regression).
check("ingest: design_tokens absent without a tailwind config", parseHtml(stylesheetHtml, "compact").design_tokens === undefined);

console.log("== tailwind config: robust across ALL config shapes (any Stitch file) ==");
// Cover the shapes the Tailwind theme config can take (v3 docs), so a DIFFERENT
// Stitch export parses correctly — not just the two flat-Material-token samples.
const twNested = `<script id="tailwind-config">tailwind.config = { theme: { extend: {
  "colors": {
    "white": "#ffffff",
    "transparent": "transparent",
    "gray": { "100": "#f3f4f6", "900": "#111827" },
    "primary": { "DEFAULT": "#2563eb", "500": "#3b82f6", "600": "#2563eb" },
    "brand": "rgb(255 0 0)"
  },
  "borderRadius": { "DEFAULT": "0.25rem", "lg": "0.5rem", "full": "9999px" },
  "fontSize": { "sm": "14px", "base": ["16px", "24px"], "lg": ["18px", { "lineHeight": "28px", "fontWeight": "700" }] },
  "fontFamily": { "sans": ["Inter", "sans-serif"], "display": "Oswald, ui-serif" }
} } }</script>`;
const cfgN = extractTailwindConfig(twNested)!;
check("tw: config detected", !!cfgN);
check("tw: nested colors flatten to token-NN", cfgN.colors["gray-100"] === "#f3f4f6" && cfgN.colors["gray-900"] === "#111827", cfgN.colors);
check("tw: nested DEFAULT collapses to parent name", cfgN.colors["primary"] === "#2563eb", cfgN.colors);
check("tw: nested non-DEFAULT keeps token-NN", cfgN.colors["primary-500"] === "#3b82f6" && cfgN.colors["primary-600"] === "#2563eb", cfgN.colors);
check("tw: flat string color kept", cfgN.colors["white"] === "#ffffff", cfgN.colors);
check("tw: keyword + rgb() color values kept", cfgN.colors["transparent"] === "transparent" && cfgN.colors["brand"] === "rgb(255 0 0)", cfgN.colors);
check("tw: fontSize plain string", cfgN.fontSize["sm"] === "14px", cfgN.fontSize);
check("tw: fontSize [size, lineHeight] pair → size", cfgN.fontSize["base"] === "16px", cfgN.fontSize);
check("tw: fontSize [size, {…}] tuple → size", cfgN.fontSize["lg"] === "18px", cfgN.fontSize);
check("tw: fontFamily array → first family", cfgN.fontFamily["sans"] === "Inter", cfgN.fontFamily);
check("tw: fontFamily string → first family", cfgN.fontFamily["display"] === "Oswald", cfgN.fontFamily);
check("tw: borderRadius DEFAULT key kept", cfgN.borderRadius["DEFAULT"] === "0.25rem" && cfgN.borderRadius["full"] === "9999px", cfgN.borderRadius);

// theme.colors OVERRIDE (no `extend`) must be found too.
const twOverride = `<script>tailwind.config = { theme: { colors: { "ink": "#0a0a0a", "accent": { "DEFAULT": "#ff6600" } } } }</script>`;
const cfgO = extractTailwindConfig(twOverride)!;
check("tw: theme.colors override (no extend) parsed", cfgO?.colors["ink"] === "#0a0a0a" && cfgO?.colors["accent"] === "#ff6600", cfgO?.colors);

// usage resolution over nested + directional-border color classes.
const twPage = `<!DOCTYPE html><html><head>${twNested}</head><body>
  <header class="bg-primary"><a class="text-gray-900">Acme storefront navigation link</a></header>
  <main><section class="border-t-primary-500"><h1 class="text-primary">Welcome to the shop</h1><p>Discover our full range of products built for everyday life.</p><img src="https://x/h.jpg"/><a class="bg-primary" href="#">Go shopping now</a></section></main>
  <footer class="bg-gray-100"><p>Footer with contact details and a short company description here.</p></footer>
</body></html>`;
const twAst = parseHtml(twPage, "compact");
check("tw: palette names every flattened token", twAst.palette?.["gray-900"] === "#111827" && twAst.palette?.["primary-500"] === "#3b82f6", twAst.palette);
check("tw: usage-ranked colors resolve nested + directional-border classes", (twAst.colors ?? []).includes("#2563eb") && (twAst.colors ?? []).includes("#111827") && (twAst.colors ?? []).includes("#3b82f6"), twAst.colors);
check("tw: design_tokens carries the resolved type scale", twAst.design_tokens?.font_size?.["lg"] === "18px" && twAst.design_tokens?.radius?.["full"] === "9999px", twAst.design_tokens);
check("tw: no config → extractTailwindConfig null", extractTailwindConfig("<div class='text-primary'>x</div>") === null);

console.log("== tailwind: gradient utilities + hover/transition effects (Stitch fidelity) ==");
const fxCfg = `<script id="tailwind-config">tailwind.config = { theme: { extend: { "colors": {
  "primary": "#0058bc", "primary-container": "#0070eb", "secondary": "#fcd664", "surface": "#ffffff"
} } } }</script>`;
const fxPage = `<!DOCTYPE html><html><head>${fxCfg}</head><body>
  <header class="bg-surface"><a class="text-primary hover:text-secondary transition-colors">Navigation menu link here</a></header>
  <main>
    <section class="bg-gradient-to-br from-primary to-primary-container"><h1 class="text-white">Join the affiliate program today</h1><p>Earn recurring commission from every referral you bring in.</p><a class="px-8 py-4 rounded-xl bg-gradient-to-br from-primary to-primary-container hover:scale-105 transition-transform" href="#">Get started now</a></section>
    <section><h2 class="text-primary">Why partners choose us</h2>
      <div class="group hover:-translate-y-1 transition-all"><img class="group-hover:scale-110" src="https://x/a.jpg"/><h3 class="group-hover:underline">Fast payouts</h3><p>Money in your account within days, not months.</p></div>
      <div class="group hover:-translate-y-1 transition-all"><img class="group-hover:scale-110" src="https://x/b.jpg"/><h3>Real-time tracking</h3><p>Watch your referrals convert in a live dashboard.</p></div>
      <div class="group hover:-translate-y-1 transition-all"><img class="group-hover:scale-110" src="https://x/c.jpg"/><h3>Dedicated support</h3><p>A partner manager helps you grow your revenue.</p></div>
    </section>
  </main>
  <footer class="bg-primary"><a class="hover:opacity-80" href="#">Footer contact and company info link</a></footer>
</body></html>`;
const fxAst = parseHtml(fxPage, "compact");
check("fx: gradient utility reconstructed with resolved color stops", (fxAst.gradients ?? []).includes("linear-gradient(to bottom right, #0058bc, #0070eb)"), fxAst.gradients);
check("fx: gradients surfaced in COMPACT mode (design-critical)", (fxAst.gradients?.length ?? 0) >= 1, fxAst.gradients);
const heroFx = fxAst.sections.find((s) => s.role === "hero");
check("fx: hero hover scale captured", (heroFx?.hover_effects ?? []).includes("scale"), heroFx?.hover_effects);
const featFx = fxAst.sections.find((s) => s.role === "features");
check("fx: card lift captured", (featFx?.hover_effects ?? []).includes("lift"), featFx?.hover_effects);
check("fx: image-zoom (group-hover scale) captured", (featFx?.hover_effects ?? []).includes("image-zoom"), featFx?.hover_effects);
check("fx: underline (group-hover) captured", (featFx?.hover_effects ?? []).includes("underline"), featFx?.hover_effects);
const headFx = fxAst.sections.find((s) => s.role === "header");
check("fx: header hover text-color-change captured", (headFx?.hover_effects ?? []).includes("text-color-change"), headFx?.hover_effects);
// arbitrary-value gradient stop resolves too.
const arbGrad = parseHtml(`<!DOCTYPE html><html><head>${fxCfg}</head><body><main><section class="bg-gradient-to-r from-[#ff0000] to-primary"><h1>Heading text for the arbitrary gradient test case here</h1><p>Some descriptive paragraph text to clear the CSR shell threshold.</p></section></main></body></html>`, "compact");
check("fx: arbitrary [#hex] gradient stop resolved", (arbGrad.gradients ?? []).includes("linear-gradient(to right, #ff0000, #0058bc)"), arbGrad.gradients);
// no tailwind config → no gradients from this path, no hover noise on a plain page.
check("fx: plain page (no config, no hover classes) has no gradients/hover", (() => { const a = parseHtml(stylesheetHtml, "compact"); return a.gradients === undefined && a.sections.every((s) => s.hover_effects === undefined); })());

console.log("== ingest: icon-font extraction (Material Symbols / Font Awesome) ==");
{
  // Feature cards with Material Symbols icons (a long ligature name + a nested-wrapper icon) and one Font Awesome card.
  const iconHtml = `<!DOCTYPE html><html><head></head><body><main><section><h2>Why choose us</h2>
    <div class="grid"><div class="card"><span class="material-symbols-outlined">verified</span><h3>Trusted</h3><p>Verified by thousands of happy partners every month.</p></div>
    <div class="card"><div class="icon-wrap"><span class="material-symbols-outlined">support_agent</span></div><h3>Support</h3><p>A dedicated manager helps you grow revenue fast.</p></div>
    <div class="card"><i class="fa-solid fa-chart-line fa-2x"></i><h3>Analytics</h3><p>Track every referral conversion in real time dashboards.</p></div></div>
  </section></main></body></html>`;
  const ia = parseHtml(iconHtml, "full");
  const fsec = ia.sections.find((s) => (s.blocks || []).length >= 3);
  const blocks = fsec?.blocks ?? [];
  check("icon: Material Symbols long ligature captured as ms:<name>", blocks[0]?.icon === "ms:verified", blocks[0]);
  check("icon: nested-wrapper Material Symbol captured", blocks[1]?.icon === "ms:support_agent", blocks[1]);
  check("icon: Font Awesome captured as fa:<name> (style tokens skipped)", blocks[2]?.icon === "fa:chart-line", blocks[2]);
  check("icon: ligature name does NOT leak into the card title", blocks[0]?.title === "Trusted" && blocks[1]?.title === "Support", blocks.map((b) => b.title));
  check("icon: real body kept (icon excluded)", /Verified by thousands/.test(blocks[0]?.body ?? ""), blocks[0]?.body);
}

console.log("== ingest: full mode — blocks detection, gradients, images-as-objects ==");
const fullAst = parseHtml(stylesheetHtml, "full");
check("ingest: full mode palette present", fullAst.palette?.["primary"] === "#0A7C6E", fullAst.palette);
check("ingest: full mode gradients extracted", (fullAst.gradients?.length ?? 0) >= 1, fullAst.gradients);
check("ingest: full mode gradient is linear-gradient", fullAst.gradients?.some((g) => g.startsWith("linear-gradient")) === true, fullAst.gradients);
const featSec = fullAst.sections.find((s) => s.role === "features");
check("ingest: full mode features section has blocks", (featSec?.blocks?.length ?? 0) >= 2, featSec?.blocks);
check("ingest: full mode block has title", !!featSec?.blocks?.[0]?.title, featSec?.blocks?.[0]);
const heroSec = fullAst.sections.find((s) => s.role === "hero");
// In full mode images should be objects with src
check("ingest: full mode hero images are objects", !!(heroSec === undefined || Array.isArray(heroSec?.images)), fullAst.sections.map((s) => s.role));
check("ingest: full mode background_images present", (fullAst.background_images?.length ?? 0) >= 1, fullAst.background_images);

console.log("== ingest: compact mode is backward-compatible (no blocks/gradients/lists) ==");
const compactAst = parseHtml(sampleHtml, "compact");
check("ingest: compact has no blocks", compactAst.sections.every((s) => s.blocks === undefined), compactAst.sections.map((s) => ({ role: s.role, hasBlocks: !!s.blocks })));
check("ingest: compact has no gradients", compactAst.gradients === undefined, compactAst.gradients);
check("ingest: compact images are plain strings", compactAst.sections.every((s) => !s.images || s.images.every((i) => typeof i === "string")), compactAst.sections.map((s) => s.images));
check("ingest: default (no detail arg) is compact-compatible", parseHtml(sampleHtml).sections.every((s) => s.blocks === undefined));

console.log("== ingest: full mode — composite widget extraction (html-box source) ==");
const widgetHtml = `<!DOCTYPE html><html><head><style>
  .phone-mockup { width: 320px; border-radius: 24px; background: #111; }
  .chat-bubble { padding: 8px 12px; border-radius: 12px; background: #f1f1f1; }
  .chat-bubble.right { background: #0A7C6E; color: #fff; }
</style></head><body>
  <section><h1>Talk to us</h1><p>Our assistant answers around the clock for you.</p><button>Start chat</button>
    <div class="phone-mockup"><div class="screen"><div class="chat-bubble left">Xin chào!</div><div class="chat-bubble right">Chào bạn</div><div class="chat-input">Type a message…</div></div><script>track()</script></div>
  </section>
  <section><h2>About</h2><p>Plain prose section with no composite widget at all.</p></section>
</body></html>`;
const widgetAst = parseHtml(widgetHtml, "full");
const wSec = widgetAst.sections[0];
check("widgets: detected on the mockup section", (wSec?.widgets?.length ?? 0) === 1, wSec?.widgets?.map((w) => w.hint));
const w0 = wSec?.widgets?.[0];
check("widgets: hint from class keyword", w0?.hint === "phone" || w0?.hint === "mockup", w0?.hint);
check("widgets: html keeps inner structure", !!w0?.html.includes("chat-bubble"), w0?.html);
check("widgets: scripts stripped from html", !(w0?.html ?? "").includes("<script"), w0?.html);
check("widgets: matching css rules attached", !!w0?.css?.includes(".phone-mockup") && !!w0?.css?.includes(".chat-bubble"), w0?.css);
check("widgets: none on plain sections", widgetAst.sections[1]?.widgets === undefined, widgetAst.sections[1]);
check("widgets: compact mode emits none", parseHtml(widgetHtml, "compact").sections.every((s) => s.widgets === undefined));

console.log("== ingest: absolute-canvas (LadiPage-family) mode ==");
// Synthetic fixture modeled on a real LadiPage export: bare positioned divs,
// per-id CSS geometry, lazyload style, data-URI arrow rule AFTER the real
// background (must not clobber it), event-data JSON, popup band, fixed CTA.
const ladiHtml = `<!DOCTYPE html><html><head><title>Ladi Test</title>
<style id="style_page">.ladi-wraper { margin: 0 auto; width: 420px; }</style>
<style id="style_element">
#SECTION1 { height: 700.4px; }
#SECTION1 > .ladi-section-background { background-size: cover; background-image: url("https://w.ladicdn.com/s768x703/abc/bg.jpg"); background-position: center top; }
#SECTION1 .ladi-section-arrow-down { background-image: url("data:image/svg+xml;utf8,%3Csvg%3B%3C/svg%3E"); }
#HEADLINE10 { width: 296px; top: 117.6px; left: 9px; }
#HEADLINE10 > .ladi-headline { color: rgb(37, 22, 199); font-size: 22px; font-weight: bold; text-align: center; line-height: 1.2; }
#IMAGE20 { width: 154.6px; height: 117.9px; top: 168px; left: 50px; }
#IMAGE20 > .ladi-image > .ladi-image-background { width: 188px; height: 125px; top: -27px; left: -24px; background-image: url("https://w.ladicdn.com/s500x450/abc/photo.png"); }
#BOX95 { width: 60px; height: 60px; top: 200px; left: 5px; }
#BOX95 > .ladi-box { border-style: solid; border-color: rgb(232, 58, 48); border-radius: 999px; }
#BOX95.ladi-animation > .ladi-box { animation-name: pulse; -webkit-animation-name: pulse; animation-delay: 1s; animation-duration: 1s; animation-iteration-count: infinite; }
#SPINLUCKY100 { width: 276px; height: 276px; top: 122px; left: 72px; }
#SPINLUCKY100 .ladi-spin-lucky-screen:before { background-image: url("https://w.ladicdn.com/s500x500/abc/wheel-face.svg"); }
#SPINLUCKY100 .ladi-spin-lucky-start { background-image: url("https://w.ladicdn.com/source/spin-btn.svg"); }
#HTML_CODE110 { width: 200px; height: 100px; top: 300px; left: 10px; }
#BUTTON30 { width: 240px; height: 40px; top: auto; left: 10px; bottom: 10px; position: fixed; z-index: 90000050; }
#BUTTON30 > .ladi-button > .ladi-button-background { background-color: rgb(232, 58, 48); }
#BUTTON_TEXT30 { width: 241px; top: 9px; left: 0px; }
#GROUP40 { width: 225px; height: 76px; top: 374px; left: 68px; }
#SHAPE50 { width: 20px; height: 20px; top: 5px; left: 5px; }
#SHAPE50 svg:last-child { fill: rgba(255, 188, 1, 1.0); }
#SECTION2 { height: 454px; }
#FORM60 { width: 299px; height: 261px; top: 80px; left: 32px; }
#FORM_ITEM61 { width: 299px; height: 43px; top: 0px; left: 0px; }
#LIST_PARAGRAPH80 { width: 379px; top: 69px; left: 21px; }
#COUNTDOWN90 { width: 225px; height: 51px; top: 10px; left: 0px; }
#POPUP70 { width: 420px; height: 516px; top: 0px; left: 0px; }
#HEADLINE71 { width: 266px; top: 5px; left: 77px; }
</style>
<style id="style_lazyload">.ladi-section-background, .ladi-image-background { background-image: none !important; }</style>
</head><body><div class="ladi-wraper">
<div id="SECTION1" class="ladi-section"><div class="ladi-section-background"></div><div class="ladi-container">
  <div id="HEADLINE10" class="ladi-element"><h3 class="ladi-headline">SẠCH TRƠN LÔNG SÁNG MỊN</h3></div>
  <div id="IMAGE20" class="ladi-element"><div class="ladi-image"><div class="ladi-image-background"></div></div></div>
  <div data-action="true" id="BUTTON30" class="ladi-element"><div class="ladi-button"><div class="ladi-button-background"></div><div id="BUTTON_TEXT30" class="ladi-element"><p class="ladi-headline">NHẬN ƯU ĐÃI NGAY</p></div></div></div>
  <div id="GROUP40" class="ladi-element"><div class="ladi-group">
    <div id="SHAPE50" class="ladi-element"><div class="ladi-shape"><svg viewBox="0 0 24 24" fill="rgba(255,188,1,1)"><path d="M0 0h24v24z"></path></svg></div></div>
  </div></div>
  <div id="BOX95" class="ladi-element ladi-animation"><div class="ladi-box"></div></div>
</div></div>
<div id="SECTION2" class="ladi-section"><div class="ladi-container">
  <div id="FORM60" class="ladi-element"><form method="post" class="ladi-form">
    <div id="FORM_ITEM61" class="ladi-element"><div class="ladi-form-item-container"><div class="ladi-form-item"><input name="phone" required type="tel" placeholder="Số điện thoại"></div></div></div>
  </form></div>
  <div id="LIST_PARAGRAPH80" class="ladi-element"><div class="ladi-list-paragraph"><ul><li>Thành phần thiên nhiên</li><li>Không đau rát</li></ul></div></div>
  <div id="COUNTDOWN90" class="ladi-element"><div class="ladi-countdown"><span>00</span></div></div>
  <div id="HTML_CODE110" class="ladi-element"><div class="ladi-html-code"><style>.ladi-foo{color:red}</style><div class="ladi-foo">embed</div></div></div>
</div></div>
<div id="SECTION_POPUP" class="ladi-section"><div class="ladi-container">
  <div id="POPUP70" class="ladi-element"><div class="ladi-popup"><div class="ladi-popup-background"></div>
    <div id="HEADLINE71" class="ladi-element"><h3 class="ladi-headline">VÒNG QUAY MAY MẮN</h3></div>
    <div id="SPINLUCKY100" class="ladi-element"><div class="ladi-spin-lucky"><div class="ladi-spin-lucky-screen"></div></div></div>
  </div></div>
</div></div>
</div>
<script id="script_event_data" type="application/json">{"BUTTON30":{"type":"button","option.data_event":[{"type":"popup","action":"POPUP70","action_type":"action"}],"mobile.option.sticky":true,"mobile.option.sticky_position":"bottom_left"},"POPUP70":{"type":"popup","option.show_popup_welcome_page":true,"option.delay_popup_welcome_page":6},"COUNTDOWN90":{"type":"countdown","option.countdown_type":"countdown","option.countdown_minute":360},"SPINLUCKY100":{"type":"spinlucky","option.spinlucky_setting.list_value":["${Buffer.from("Mất lượt|Mất lượt|0%", "utf8").toString("base64")}","${Buffer.from("FreeShip|FreeShip|100%", "utf8").toString("base64")}"],"option.spinlucky_setting.max_turn":1}}</script>
<script>window.LadiPageScript.runtime.is_mobile_only = true;</script>
</body></html>`;
const ladi = parseHtml(ladiHtml);
check("ladi: canvas payload detected", !!ladi.canvas, Object.keys(ladi));
const cv = ladi.canvas!;
check("ladi: builder/width/mobile_only", cv.builder === "ladi" && cv.width === 420 && cv.mobile_only === true, cv);
check("ladi: 2 page sections (popup band separated)", cv.sections.length === 2, cv.sections.map((s) => s.id));
check("ladi: section height from per-id css", cv.sections[0].height === 700, cv.sections[0].height);
check("ladi: section bg survives data-URI arrow rule + size prefix stripped", cv.sections[0].background?.["background-image"] === "https://w.ladicdn.com/abc/bg.jpg", cv.sections[0].background);
const ladiEls = cv.sections[0].elements;
const ladiH = ladiEls.find((e) => e.id === "HEADLINE10");
check("ladi: headline box geometry (px, rounded)", ladiH?.box?.width === 296 && ladiH?.box?.top === 118 && ladiH?.box?.left === 9, ladiH?.box);
check("ladi: headline text + typography style", ladiH?.text === "SẠCH TRƠN LÔNG SÁNG MỊN" && ladiH?.style?.["font-size"] === "22px", ladiH);
const ladiImg = ladiEls.find((e) => e.id === "IMAGE20");
check("ladi: image src from bg rule, full-size original", ladiImg?.src === "https://w.ladicdn.com/abc/photo.png", ladiImg);
const ladiBtn = ladiEls.find((e) => e.id === "BUTTON30");
check("ladi: fixed button → box.fixed + sticky position", ladiBtn?.box?.fixed === true && ladiBtn?.sticky === "bottom_left", ladiBtn);
check("ladi: button event → open popup", ladiBtn?.events?.[0]?.type === "popup" && ladiBtn?.events?.[0]?.action === "POPUP70", ladiBtn?.events);
check("ladi: button_text nested as child", ladiBtn?.children?.[0]?.id === "BUTTON_TEXT30" && ladiBtn?.children?.[0]?.text === "NHẬN ƯU ĐÃI NGAY", ladiBtn?.children);
const ladiGrp = ladiEls.find((e) => e.id === "GROUP40");
check("ladi: group nests shape with svg + fill", ladiGrp?.children?.[0]?.type === "shape" && !!ladiGrp?.children?.[0]?.svg && ladiGrp?.children?.[0]?.style?.fill === "rgba(255, 188, 1, 1.0)", ladiGrp?.children);
const ladiForm = cv.sections[1].elements.find((e) => e.id === "FORM60");
check("ladi: form_item input facts captured", ladiForm?.children?.[0]?.input?.name === "phone" && ladiForm?.children?.[0]?.input?.input_type === "tel" && ladiForm?.children?.[0]?.input?.required === true, ladiForm?.children?.[0]);
const ladiList = cv.sections[1].elements.find((e) => e.id === "LIST_PARAGRAPH80");
check("ladi: list items joined as text", ladiList?.type === "list" && ladiList?.text === "Thành phần thiên nhiên\nKhông đau rát", ladiList);
const ladiCd = cv.sections[1].elements.find((e) => e.id === "COUNTDOWN90");
check("ladi: countdown config from event data", ladiCd?.config?.["countdown_minute"] === 360, ladiCd);
check("ladi: popup separated top-level w/ config", cv.popups?.[0]?.id === "POPUP70" && cv.popups?.[0]?.config?.["delay_popup_welcome_page"] === 6, cv.popups);
check("ladi: popup keeps its own children", cv.popups?.[0]?.children?.[0]?.text === "VÒNG QUAY MAY MẮN", cv.popups?.[0]?.children);
check("ladi: role sections still emitted with css size_hint", ladi.sections.length === 2 && ladi.sections[0].size_hint?.height === 700 && ladi.sections[0].size_hint?.basis === "css", ladi.sections);
check("ladi: form role propagated to role section", ladi.sections[1].role === "form", ladi.sections.map((s) => s.role));
check("ladi: classic html gets no canvas", parseHtml(sampleHtml).canvas === undefined);
check("ladi: image crop (offset/zoom inner layer) captured", ladiImg?.crop?.width === 188 && ladiImg?.crop?.top === -27 && ladiImg?.crop?.left === -24, ladiImg?.crop);
const ladiBox = ladiEls.find((e) => e.id === "BOX95");
check("ladi: animation captured from .ladi-animation rule", ladiBox?.animation?.["name"] === "pulse" && ladiBox?.animation?.["iteration-count"] === "infinite", ladiBox?.animation);
check("ladi: animation rule does not pollute base style", ladiBox?.style?.["border-radius"] === "999px" && (ladiBox?.style as any)?.["animation-name"] === undefined, ladiBox?.style);
const ladiSpin = cv.popups?.[0]?.children?.find((e) => e.id === "SPINLUCKY100");
check("ladi: spin-wheel prizes decoded from base64", (ladiSpin?.config?.["prizes"] as any)?.[0]?.label === "Mất lượt" && (ladiSpin?.config?.["prizes"] as any)?.[1]?.chance === "100%", ladiSpin?.config);
check("ladi: spin-wheel max_turn kept", ladiSpin?.config?.["spinlucky_setting.max_turn"] === 1, ladiSpin?.config);
check(
  "ladi: spin-wheel face + button images captured separately (no collision, CDN prefix stripped)",
  ladiSpin?.config?.["wheelImage"] === "https://w.ladicdn.com/abc/wheel-face.svg" &&
    ladiSpin?.config?.["buttonImage"] === "https://w.ladicdn.com/source/spin-btn.svg",
  { wheelImage: ladiSpin?.config?.["wheelImage"], buttonImage: ladiSpin?.config?.["buttonImage"] }
);
const onlyS2 = parseHtml(ladiHtml, "compact", { sections: ["SECTION2"] }).canvas;
check("ladi: sections filter → only SECTION2, no popups", onlyS2?.sections.length === 1 && onlyS2?.sections[0].id === "SECTION2" && onlyS2?.popups === undefined, onlyS2?.sections.map((s) => s.id));
const onlyPopup = parseHtml(ladiHtml, "compact", { sections: ["SECTION_POPUP"] }).canvas;
check("ladi: sections filter → SECTION_POPUP selects popups only", onlyPopup?.sections.length === 0 && onlyPopup?.popups?.[0]?.id === "POPUP70", { sections: onlyPopup?.sections.length, popups: onlyPopup?.popups?.map((p) => p.id) });

console.log("== canvas-to-source: deterministic LadiPage canvas → Webcake source ==");
check("clone: domain.canvasToSource is wired", typeof landingDomain.canvasToSource === "function");
const cloneOut = landingDomain.canvasToSource!(cv, { title: "Ladi Clone" });
const cloneSrc: any = cloneOut.source;
check("clone: 2 page sections + 1 popup produced", cloneSrc.page.length === 2 && cloneSrc.popup.length === 1, {
  page: cloneSrc.page.length,
  popup: cloneSrc.popup.length,
});
// end-to-end: the sparse clone expands + validates exactly like a create_page payload
const cloneExpanded = landingDomain.expand(cloneSrc);
const cloneVr = landingDomain.validate(cloneExpanded);
check("clone: expands + validates with 0 errors", cloneVr.valid, cloneVr.errors.slice(0, 6));
const cSec1: any = cloneSrc.page[0];
const cH = cSec1.children.find((c: any) => c.id === "headline10");
check(
  "clone: headline → text-block w/ text + box geometry",
  cH?.type === "text-block" && cH.specials.text.includes("SẠCH TRƠN") && cH.responsive.mobile.styles.top === 118 && cH.responsive.mobile.styles.width === 296,
  cH
);
const cImg = cSec1.children.find((c: any) => c.id === "image20");
check("clone: image → image-block w/ full-size src", cImg?.type === "image-block" && cImg.specials.src === "https://w.ladicdn.com/abc/photo.png", cImg?.specials);
check("clone: image offset/zoom crop → bgImage config", cImg?.responsive.desktop.config?.widthBgImage === 188 && cImg?.responsive.desktop.config?.topBgImage === -27, cImg?.responsive.desktop.config);
// the publish renderer paints image-blocks ONLY from styles.background; the real src
// must land there on expand and NOT be left as the seed's placeholder url.
const cImgExp: any = (cloneExpanded as any).page[0].children.find((c: any) => c.id === "image20");
check(
  "clone: image-block published background derives from the REAL src (placeholder seed must not win)",
  /ladicdn\.com\/abc\/photo\.png/.test(cImgExp?.responsive?.desktop?.styles?.background ?? "") &&
    !/placehold\.co/.test(cImgExp?.responsive?.desktop?.styles?.background ?? ""),
  cImgExp?.responsive?.desktop?.styles?.background
);
const cBtn = cSec1.children.find((c: any) => c.id === "button30");
check("clone: button label from button_text child", cBtn?.type === "button" && cBtn.specials.text === "NHẬN ƯU ĐÃI NGAY", cBtn?.specials);
check("clone: button popup event mapped to open_popup", cBtn?.events?.[0]?.action === "open_popup" && cBtn?.events?.[0]?.target === "popup70", cBtn?.events);
check(
  "clone: fixed element pinned via sticky config (b-l) + in-flow fallback box",
  cBtn?.responsive.mobile.config?.sticky === true &&
    cBtn?.responsive.mobile.config?.stickyPosition === "b-l" &&
    cBtn?.responsive.mobile.config?.stickyLeft === 10 &&
    cBtn?.responsive.mobile.config?.stickyBottom === 10 &&
    cBtn?.responsive.mobile.styles.top === 650 &&
    cBtn?.responsive.mobile.styles.left === 10 &&
    cloneOut.notes.some((n) => /pinned as a sticky/.test(n)),
  { config: cBtn?.responsive.mobile.config, styles: cBtn?.responsive.mobile.styles, notes: cloneOut.notes }
);
const cGrp = cSec1.children.find((c: any) => c.id === "group40");
const cShape = cGrp?.children?.[0];
check("clone: group keeps shape child as rectangle w/ svgMask + fill bg", cGrp?.type === "group" && cShape?.type === "rectangle" && !!cShape.responsive.desktop.config?.svgMask && cShape.responsive.desktop.styles.background === "rgba(255, 188, 1, 1.0)", cShape?.responsive.desktop);
const cBox = cSec1.children.find((c: any) => c.id === "box95");
check("clone: box animation → config.animation.name", cBox?.responsive.desktop.config?.animation?.name === "pulse", cBox?.responsive.desktop.config);
const cSec2: any = cloneSrc.page[1];
const cForm = cSec2.children.find((c: any) => c.id === "form60");
const cInput = cForm?.children?.[0];
check("clone: form_item → input child w/ mapped field_name", cForm?.type === "form" && cInput?.type === "input" && cInput.specials.field_name === "phone_number" && cInput.specials.field_type === "phone" && cInput.specials.required === true, cInput?.specials);
const cList = cSec2.children.find((c: any) => c.id === "list_paragraph80");
check("clone: list → list-paragraph w/ <li> items", cList?.type === "list-paragraph" && cList.specials.text.includes("<li>Thành phần thiên nhiên</li>"), cList?.specials);
const cCd = cSec2.children.find((c: any) => c.id === "countdown90");
check("clone: countdown duration from config", cCd?.type === "countdown" && cCd.specials.duration === "360", cCd?.specials);
const cPop: any = cloneSrc.popup[0];
check("clone: popup openInPage + delay from event data", cPop?.type === "popup" && cPop.specials.openInPage === true && cPop.specials.delayPopup === 6, cPop?.specials);
const cSpin = cPop?.children?.find((c: any) => c.id === "spinlucky100");
check("clone: spin-wheel prizes encoded, percents kept (sum 100)", cSpin?.type === "spin-wheel" && cSpin.specials.code === "PRIZE1|Mất lượt|0\nPRIZE2|FreeShip|100", cSpin?.specials?.code);
check(
  "clone: spin-wheel uses the ORIGINAL wheel + button art (not the editor default)",
  cSpin?.specials?.background === "https://w.ladicdn.com/abc/wheel-face.svg" &&
    cSpin?.specials?.backgroundBtn === "https://w.ladicdn.com/source/spin-btn.svg",
  { background: cSpin?.specials?.background, backgroundBtn: cSpin?.specials?.backgroundBtn }
);
const cHtmlBox = cSec2.children.find((c: any) => c.id === "html_code110");
check(
  "clone: html-box passthrough renames builder classes (ladi-html-code → webcake-html-box, inline .ladi-* CSS too)",
  cHtmlBox?.type === "html-box" &&
    /webcake-html-box/.test(cHtmlBox.specials.html) &&
    /webcake-foo/.test(cHtmlBox.specials.html) &&
    !/ladi-/.test(cHtmlBox.specials.html),
  cHtmlBox?.specials?.html
);

console.log("== expand: image-block published background derives from specials.src (placeholder seed must not win) ==");
{
  const mk = (src: string) => ({
    page: [{ id: "s", type: "section", responsive: { desktop: { styles: { height: 300 } }, mobile: { styles: { height: 300 } } }, children: [
      { id: "im", type: "image-block", responsive: { desktop: { styles: { top: 0, left: 0, width: 100, height: 80 } }, mobile: { styles: { top: 0, left: 0, width: 100, height: 80 } } }, specials: { src } },
    ] }], popup: [], settings: {}, options: {}, cartConfigs: {},
  });
  const real: any = (landingDomain.expand(mk("https://cdn.example.com/real.jpg")) as any).page[0].children[0];
  check("expand: real specials.src → styles.background = that url (BOTH breakpoints)",
    /cdn\.example\.com\/real\.jpg/.test(real.responsive.desktop.styles.background) &&
    /cdn\.example\.com\/real\.jpg/.test(real.responsive.mobile.styles.background) &&
    !/placehold\.co/.test(real.responsive.desktop.styles.background),
    real.responsive.desktop.styles.background);
  const ph: any = (landingDomain.expand(mk("https://placehold.co/100x80?text=Image")) as any).page[0].children[0];
  check("expand: placeholder specials.src → keeps a placeholder background", /placehold\.co/.test(ph.responsive.desktop.styles.background), ph.responsive.desktop.styles.background);
}

console.log("== ingest: mojibake repair (UTF-8 mis-read as Latin-1) ==");
const vietText = "TẨY LÔNG – Kem tẩy lông Huyền Phi sạch trơn sáng mịn an toàn hiệu quả nhanh chóng";
const garbled = Buffer.from(vietText, "utf8").toString("latin1");
const mojibakeAst = parseHtml(`<!DOCTYPE html><html><head><title>${garbled}</title></head><body><section><h1>${garbled}</h1><p>${garbled}. ${garbled}.</p></section><section><h2>${garbled}</h2><p>${garbled}</p></section></body></html>`);
check("mojibake: title repaired", mojibakeAst.title === vietText, mojibakeAst.title);
check("mojibake: repair warning emitted", (mojibakeAst.warnings ?? []).some((w) => w.includes("encoding repaired")), mojibakeAst.warnings);
check("mojibake: genuine Vietnamese untouched", parseHtml(`<html><head><title>${vietText}</title></head><body><p>${vietText} ${vietText} ${vietText}</p></body></html>`).title === vietText);

console.log("== ingest: nested-grid block detection (depth > 1) ==");
// section > .grid-wrapper > .card  — blocks must be found even though cards are not direct children
const nestedGridHtml = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
  <section id="challenges">
    <h2>Challenges</h2>
    <div class="challenge-grid">
      <div class="challenge-card"><div class="challenge-icon">📡</div><div class="challenge-title">Too many channels</div><div class="challenge-body">No unified view of who is asking what.</div></div>
      <div class="challenge-card"><div class="challenge-icon">📩</div><div class="challenge-title">Inquiry overload</div><div class="challenge-body">Dozens of repetitive questions drain staff.</div></div>
      <div class="challenge-card"><div class="challenge-icon">👋</div><div class="challenge-title">Guests who book once</div><div class="challenge-body">No way to re-engage past guests.</div></div>
    </div>
  </section>
  <section id="how">
    <h2>How it works</h2>
    <div class="hiw-steps">
      <div class="hiw-step"><div class="hiw-icon">📡</div><h3>Multi-channel Inquiry</h3><p>Guest reaches out via Booking.com or Messenger.</p></div>
      <div class="hiw-step"><div class="hiw-icon">🤖</div><h3>AI Handles Instantly</h3><p>Botcake AI replies 24/7 in their language.</p></div>
      <div class="hiw-step"><div class="hiw-icon">📇</div><h3>CRM Auto-captures</h3><p>Name, dates, preferences saved automatically.</p></div>
      <div class="hiw-step"><div class="hiw-icon">🔄</div><h3>Re-engage After Stay</h3><p>Past guests receive personalised promos.</p></div>
    </div>
  </section>
  <section id="integrations">
    <h2>Integrations</h2>
    <div class="int-grid">
      <div class="int-card"><div class="int-icon">🏠</div><div class="int-name">Booking.com</div><div class="int-desc">Sync booking inquiries into your inbox.</div></div>
      <div class="int-card"><div class="int-icon">👍</div><div class="int-name">Facebook</div><div class="int-desc">Messenger and Live comment auto-reply.</div></div>
      <div class="int-card"><div class="int-icon">📸</div><div class="int-name">Instagram</div><div class="int-desc">DMs and comment replies in one place.</div></div>
      <div class="int-card"><div class="int-icon">🎵</div><div class="int-name">TikTok</div><div class="int-desc">Auto-reply to Live comments and DMs.</div></div>
      <div class="int-card"><div class="int-icon">💬</div><div class="int-name">WhatsApp</div><div class="int-desc">Manage WA Business messages here.</div></div>
    </div>
  </section>
</body></html>`;
const nestedAst = parseHtml(nestedGridHtml, "full");
const challengeSec = nestedAst.sections.find((s) => s.heading?.includes("Challenges"));
check("nested-grid: challenges section found", !!challengeSec, nestedAst.sections.map((s) => s.heading));
check("nested-grid: 3 challenge blocks detected", (challengeSec?.blocks?.length ?? 0) === 3, challengeSec?.blocks?.map((b) => b.title));
check("nested-grid: challenge block has icon", !!challengeSec?.blocks?.[0]?.icon, challengeSec?.blocks?.[0]);
check("nested-grid: challenge block has title", !!challengeSec?.blocks?.[0]?.title, challengeSec?.blocks?.[0]);
const hiwSec = nestedAst.sections.find((s) => s.heading?.includes("How it works"));
check("nested-grid: 4 hiw blocks detected", (hiwSec?.blocks?.length ?? 0) === 4, hiwSec?.blocks?.map((b) => b.title));
check("nested-grid: hiw block title from h3", hiwSec?.blocks?.[0]?.title === "Multi-channel Inquiry", hiwSec?.blocks?.[0]);
const intSec = nestedAst.sections.find((s) => s.heading?.includes("Integrations"));
check("nested-grid: 5 integration blocks detected", (intSec?.blocks?.length ?? 0) === 5, intSec?.blocks?.map((b) => b.title));
check("nested-grid: integration block title from name-class div", intSec?.blocks?.[0]?.title === "Booking.com", intSec?.blocks?.[0]);

console.log("== ingest: repeated-div section pickup (non-semantic top-level divs) ==");
// A <div class="stat-bar"> at body level alongside <section> tags must become its own section.
const statBarHtml = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
  <section class="hero"><h1>Hero</h1><p>Welcome.</p><a href="#" class="btn">CTA</a></section>
  <div class="stat-bar">
    <div class="stat-item"><div class="stat-num">6+</div><div class="stat-label">Channels unified</div></div>
    <div class="stat-item"><div class="stat-num">24/7</div><div class="stat-label">AI support</div></div>
    <div class="stat-item"><div class="stat-num">3x</div><div class="stat-label">Faster response</div></div>
    <div class="stat-item"><div class="stat-num">0</div><div class="stat-label">No CRM needed</div></div>
  </div>
  <section class="features"><h2>Features</h2>
    <div><h3>Speed</h3><p>Fast.</p></div>
    <div><h3>Scale</h3><p>Big.</p></div>
    <div><h3>Safety</h3><p>Secure.</p></div>
  </section>
</body></html>`;
const statAst = parseHtml(statBarHtml, "full");
const statRoles = statAst.sections.map((s) => s.role);
check("stat-bar: at least 3 sections found (hero + stat-bar + features)", statAst.sections.length >= 3, statRoles);
const statSec = statAst.sections.find((s) => {
  // stat-bar is not a semantic section so it lands as unknown; identify by its blocks
  return s.blocks && s.blocks.length >= 4;
});
check("stat-bar: stat-bar div becomes a section with 4 blocks", (statSec?.blocks?.length ?? 0) === 4, statAst.sections.map((s) => ({ role: s.role, blocks: s.blocks?.length })));

console.log("== ingest: pricing section heuristic ==");
const pricingHtml = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
  <section class="hero"><h1>App</h1><p>Great app for you.</p><a href="#" class="btn">Start</a></section>
  <section id="pricing">
    <h2>Plans</h2>
    <div class="pricing-card">
      <h3>Pro</h3>
      <div class="price">$269</div>
      <div class="period">/month</div>
      <ul><li>Feature A</li><li>Feature B</li></ul>
      <a href="#" class="btn">Get started</a>
    </div>
  </section>
  <footer><p>Footer text here for the page.</p></footer>
</body></html>`;
const pricingAst = parseHtml(pricingHtml, "full");
const pricingSecRoles = pricingAst.sections.map((s) => s.role);
check("pricing: section with id=pricing classified as pricing", pricingSecRoles.includes("pricing"), pricingSecRoles);
check("pricing: not mis-classified as features", !pricingSecRoles.includes("features") || pricingSecRoles.includes("pricing"), pricingSecRoles);

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

  // The RETURNED editor link must sign the browser in: the /editor route sits
  // behind the jwt-cookie passport, so the link is wrapped in the builder
  // host's public /transport?token=&redirect_uri= cookie-setting redirect.
  const loginUrl = toEditorLoginUrl(localCfg, "/editor/v2/abc")!;
  check("editor login url goes through /transport on the builder host", loginUrl.startsWith("http://builder.localhost:5800/transport?token="), loginUrl);
  check("editor login url carries the jwt as token", loginUrl.includes("token=t&"), loginUrl);
  check("editor login url percent-encodes the redirect target", loginUrl.endsWith(`redirect_uri=${encodeURIComponent("http://builder.localhost:5800/editor/v2/abc")}`), loginUrl);
  check("editor login url passthrough when empty", toEditorLoginUrl(localCfg, undefined) === undefined);
  check("editor login url stays bare without a jwt", toEditorLoginUrl({ ...localCfg, jwt: "" }, "/editor/v2/abc") === "http://builder.localhost:5800/editor/v2/abc");

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

  // publish request preview: JWT must be masked everywhere. Without a build
  // (willRender=false) the LEGACY source-only route is used…
  const pub = buildPublishRequestRedacted({ ...localCfg, jwt: "SECRETJWT" }, "pg1", { page: [] }, { customDomain: "shop.example.com", customPath: "sale" });
  check("legacy publish preview hits /edit/publish on the BUILDER host", pub.url === "http://builder.localhost:5800/api/pages/pg1/edit/publish", pub.url);
  check("legacy publish preview masks the JWT", !JSON.stringify(pub).includes("SECRETJWT"), pub);
  check("legacy publish preview carries domain/path + source string", pub.body.includes("shop.example.com") && pub.body.includes("custom_path") && pub.body.includes("is_publish"), pub.body);
  check("legacy publish preview is marked rendered:false", pub.rendered === false, pub);
  // …with a build (willRender=true) the editor's publish_html route — the only
  // one that writes the PagePublishedV2 record public serving reads — is used,
  // with the editor-shaped body (data_node, no `source` key).
  const pubHtml = buildPublishRequestRedacted({ ...localCfg, jwt: "SECRETJWT" }, "pg1", { page: [], options: { mobileOnly: true } }, { customDomain: "shop.example.com" }, true);
  check("rendered publish preview hits /edit/publish_html on the BUILDER host", pubHtml.url === "http://builder.localhost:5800/api/pages/pg1/edit/publish_html", pubHtml.url);
  check("rendered publish preview masks the JWT", !JSON.stringify(pubHtml).includes("SECRETJWT"), pubHtml);
  check("rendered publish preview uses the editor body shape", pubHtml.body.includes("data_node") && pubHtml.body.includes("selected_custom_domain") && pubHtml.body.includes("render_type"), pubHtml.body);
  check("rendered publish preview folds mobile_only into settings", pubHtml.body.includes('"mobile_only":true'), pubHtml.body);
  check("rendered publish preview stands in a placeholder for the unbuilt app", pubHtml.body.includes("built by the build host"), pubHtml.body);
  check("rendered publish preview is marked rendered:true", pubHtml.rendered === true, pubHtml);
}

console.log("== login: connect URL + loopback callback parsing (offline) ==");
{
  // The browser round-trip contract: state must survive into the connect URL
  // (the Windows `cmd start` bug cut the URL at the bare `&`), and the loopback
  // callback must reject anything without the matching state.
  const url = buildConnectUrl("https://webcake.io/mcp-connect", "http://127.0.0.1:51234/callback", "abc123");
  check("connect url keeps the state param", url.endsWith("&state=abc123"), url);
  check("connect url percent-encodes redirect_uri", url.includes("redirect_uri=http%3A%2F%2F127.0.0.1%3A51234%2Fcallback"), url);
  check("connect url joins with & when a query already exists", buildConnectUrl("https://x.test/c?a=1", "http://127.0.0.1:1/callback", "s").includes("?a=1&redirect_uri="));

  const okCb = parseCallback("/callback?token=tok&state=abc", "abc");
  check("callback with token+state accepted", okCb.ok && okCb.token === "tok", okCb);
  const wrongState = parseCallback("/callback?token=tok&state=other", "abc");
  check("callback with wrong state rejected (400)", !wrongState.ok && wrongState.status === 400, wrongState);
  const noState = parseCallback("/callback?token=tok", "abc");
  check("callback with missing state rejected (400)", !noState.ok && noState.status === 400, noState);
  const noToken = parseCallback("/callback?state=abc", "abc");
  check("callback without token rejected (400)", !noToken.ok && noToken.status === 400, noToken);
  const wrongPath = parseCallback("/favicon.ico", "abc");
  check("non-callback path → 404", !wrongPath.ok && wrongPath.status === 404, wrongPath);
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

console.log("== draft-cache: sliding TTL (every touch refreshes the clock) ==");
{
  const id = putDraft({ source: { page: [] } });
  const entry = getDraft(id)!;
  // Backdate the entry (getDraft returns the live object), then touch it again:
  // the read must refresh `created` to ~now so an active workflow never expires.
  entry.created = Date.now() - 10_000;
  const touched = getDraft(id);
  check("sliding TTL: getDraft refreshes created", touched != null && Date.now() - touched.created < 2_000, touched && Date.now() - touched.created);
  // updateDraft refreshes too.
  touched!.created = Date.now() - 10_000;
  updateDraft(id, { page: [] });
  check("sliding TTL: updateDraft refreshes created", Date.now() - getDraft(id)!.created < 2_000);
  deleteDraft(id);
  // An UNTOUCHED draft must still expire (default TTL 2h; skip when overridden).
  if (!process.env.WEBCAKE_DRAFT_TTL_MS) {
    const stale = putDraft({ source: { page: [] } });
    getDraft(stale)!.created = Date.now() - 3 * 60 * 60 * 1000;
    check("sliding TTL: untouched draft still expires", getDraft(stale) === null);
  }
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

console.log("== borderRadius normalization: numeric/unitless coerced to px by expand ==");
{
  // Helper: build a minimal page source with a button carrying a given borderRadius value.
  const mkBrPage = (brValue: unknown) => ({
    page: [
      {
        id: "br_sec", type: "section",
        responsive: { desktop: { styles: { height: 400, background: "rgba(17,24,39,1)" } }, mobile: { styles: { height: 400, background: "rgba(17,24,39,1)" } } },
        children: [
          {
            id: "br_btn", type: "button",
            responsive: {
              desktop: { styles: { top: 10, left: 10, width: 150, height: 44, borderRadius: brValue } },
              mobile:  { styles: { top: 10, left: 10, width: 150, height: 44, borderRadius: brValue } },
            },
            specials: { text: "Test" },
          },
        ],
      },
    ],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });

  // 1) numeric 16 → "16px" on both breakpoints
  const exp16: any = landingDomain.expand(mkBrPage(16));
  const btn16 = exp16.page[0].children[0];
  check(
    "borderRadius: number 16 → '16px' on desktop",
    btn16.responsive.desktop.styles.borderRadius === "16px",
    btn16.responsive.desktop.styles.borderRadius
  );
  check(
    "borderRadius: number 16 → '16px' on mobile",
    btn16.responsive.mobile.styles.borderRadius === "16px",
    btn16.responsive.mobile.styles.borderRadius
  );

  // 2) unit-less string "16" → "16px"
  const expStr: any = landingDomain.expand(mkBrPage("16"));
  const btnStr = expStr.page[0].children[0];
  check(
    "borderRadius: unitless string '16' → '16px' on desktop",
    btnStr.responsive.desktop.styles.borderRadius === "16px",
    btnStr.responsive.desktop.styles.borderRadius
  );

  // 3) proper string "8px" left untouched
  const expUnit: any = landingDomain.expand(mkBrPage("8px"));
  const btnUnit = expUnit.page[0].children[0];
  check(
    "borderRadius: '8px' string left untouched",
    btnUnit.responsive.desktop.styles.borderRadius === "8px",
    btnUnit.responsive.desktop.styles.borderRadius
  );

  // 4) "50%" left untouched
  const expPct: any = landingDomain.expand(mkBrPage("50%"));
  const btnPct = expPct.page[0].children[0];
  check(
    "borderRadius: '50%' string left untouched",
    btnPct.responsive.desktop.styles.borderRadius === "50%",
    btnPct.responsive.desktop.styles.borderRadius
  );

  // 5) multi-corner string "16px 16px 0 0" left untouched
  const expMulti: any = landingDomain.expand(mkBrPage("16px 16px 0 0"));
  const btnMulti = expMulti.page[0].children[0];
  check(
    "borderRadius: '16px 16px 0 0' string left untouched",
    btnMulti.responsive.desktop.styles.borderRadius === "16px 16px 0 0",
    btnMulti.responsive.desktop.styles.borderRadius
  );

  // 6) expand(compact(x)) round-trip invariant with coerced borderRadius
  // compact(expand(page-with-br-number)) → expand again must equal expand(original)
  const expanded16 = landingDomain.expand(mkBrPage(16));
  const compacted16 = landingDomain.compact(expanded16);
  const reexpanded16 = landingDomain.expand(compacted16);
  check(
    "borderRadius round-trip: expand(compact(expand(br=16))) deep-equals expand(br=16)",
    deepEq(reexpanded16, expanded16)
  );
}

console.log("== background normalization: url() layers canonicalised to the editor shorthand ==");
{
  const CANON = "center center/ cover no-repeat scroll content-box url(https://x.test/a.jpg) border-box";
  const mkBgPage = (bgValue: string) => ({
    page: [
      {
        id: "bg_sec", type: "section",
        responsive: {
          desktop: { styles: { height: 400, background: bgValue } },
          mobile:  { styles: { height: 400, background: bgValue } },
        },
        children: [],
      },
    ],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  const bgOf = (src: any) => src.page[0].responsive.desktop.styles.background;

  // 1) plain-CSS url layer (reference-page style) → canonical shorthand
  const expPlain: any = landingDomain.expand(mkBgPage("url(https://x.test/a.jpg) center/cover no-repeat"));
  check("background: plain 'url(x) center/cover no-repeat' → canonical", bgOf(expPlain) === CANON, bgOf(expPlain));

  // 2) gradient overlay + non-canonical url layer → gradient kept, url layer canonicalised
  const grad = "linear-gradient(160deg, rgba(13,45,58,0.88) 0%, rgba(10,124,110,0.75) 60%, rgba(13,45,58,0.9) 100%)";
  const expGrad: any = landingDomain.expand(mkBgPage(`${grad}, url(https://x.test/a.jpg) center/cover`));
  check("background: gradient + url layer → gradient kept + canonical url", bgOf(expGrad) === `${grad}, ${CANON}`, bgOf(expGrad));

  // 3) editor-mangled 'undefined/ …' layer → repaired to canonical, gradient kept
  const expBroken: any = landingDomain.expand(
    mkBgPage(`${grad}, undefined/ undefined/ undefined/ undefined/ content-box url(https://x.test/a.jpg)`)
  );
  check("background: mangled 'undefined/…' url layer → repaired", bgOf(expBroken) === `${grad}, ${CANON}`, bgOf(expBroken));

  // 4) already-canonical layer left byte-identical (idempotent)
  const expCanon: any = landingDomain.expand(mkBgPage(CANON));
  check("background: canonical layer untouched", bgOf(expCanon) === CANON, bgOf(expCanon));

  // 5) gradient-only / color-only backgrounds untouched
  const expOnlyGrad: any = landingDomain.expand(mkBgPage(grad));
  check("background: gradient-only untouched", bgOf(expOnlyGrad) === grad, bgOf(expOnlyGrad));

  // 6) expand(compact(x)) invariant with a canonicalised background
  const expanded = landingDomain.expand(mkBgPage(`${grad}, url(https://x.test/a.jpg) center/cover`));
  const reexpanded = landingDomain.expand(landingDomain.compact(expanded));
  check("background round-trip: expand(compact(expand(x))) deep-equals expand(x)", deepEq(reexpanded, expanded));
}

console.log("== text-block styles.background warning (gradient-text-fill mode) ==");
{
  const mkTbBgPage = (bgValue: string, withClip: boolean) => ({
    page: [
      {
        id: "tb_sec", type: "section",
        responsive: {
          desktop: { config: {}, styles: { position: "relative", height: 400, background: "rgba(17,24,39,1)" } },
          mobile:  { config: {}, styles: { position: "relative", height: 400, background: "rgba(17,24,39,1)" } },
        },
        specials: {}, runtime: {}, events: [],
        children: [
          {
            id: "tb1", type: "text-block",
            properties: { name: "T", movable: true, sync: true },
            responsive: {
              desktop: {
                config: {}, styles: Object.assign(
                  { top: 10, left: 10, width: 200, height: 40, background: bgValue },
                  withClip ? { "-webkitBackgroundClip": "text" } : {}
                ),
              },
              mobile: {
                config: {}, styles: { top: 10, left: 10, width: 200, height: 40 },
              },
            },
            specials: { text: "hello", tag: "p" },
            runtime: {}, events: [],
          },
        ],
      },
    ],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });

  // 1) background set, no clip → warning
  const rNoBg = validatePage(mkTbBgPage("linear-gradient(90deg,rgba(255,0,0,1),rgba(0,0,255,1))", false));
  check(
    "text-block: styles.background without -webkitBackgroundClip → warning",
    rNoBg.warnings.some((w) => w.includes("text-block") && w.includes("gradient text-fill") && w.includes("backgroundTxt")),
    rNoBg.warnings
  );

  // 2) background + clip → no warning about gradient text-fill
  const rWithClip = validatePage(mkTbBgPage("linear-gradient(90deg,rgba(255,0,0,1),rgba(0,0,255,1))", true));
  check(
    "text-block: styles.background WITH -webkitBackgroundClip → no gradient-fill warning",
    !rWithClip.warnings.some((w) => w.includes("gradient text-fill")),
    rWithClip.warnings
  );

  // 3) no background on text-block → no gradient-fill warning
  const rNoBg2 = validatePage({
    page: [
      {
        id: "tb_sec2", type: "section",
        properties: { name: "S", movable: false, sync: true },
        responsive: {
          desktop: { config: {}, styles: { position: "relative", height: 400, background: "rgba(17,24,39,1)" } },
          mobile:  { config: {}, styles: { position: "relative", height: 400, background: "rgba(17,24,39,1)" } },
        },
        specials: {}, runtime: {}, events: [],
        children: [
          {
            id: "tb2", type: "text-block",
            properties: { name: "T", movable: true, sync: true },
            responsive: {
              desktop: { config: {}, styles: { top: 10, left: 10, width: 200, height: 40, color: "rgba(255,255,255,1)" } },
              mobile:  { config: {}, styles: { top: 10, left: 10, width: 200, height: 40, color: "rgba(255,255,255,1)" } },
            },
            specials: { text: "hello", tag: "p" },
            runtime: {}, events: [],
          },
        ],
      },
    ],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  check(
    "text-block: no styles.background → no gradient-fill warning",
    !rNoBg2.warnings.some((w) => w.includes("gradient text-fill")),
    rNoBg2.warnings
  );
}

console.log("== warningsField: warnings ship with the fix-list directive ==");
{
  const withW = warningsField(["page[0]: something"]) as any;
  check("warningsField: non-empty warnings carry warnings_notice", Array.isArray(withW.warnings) && typeof withW.warnings_notice === "string" && withW.warnings_notice.includes("FIX THESE WARNINGS"), withW);
  check("warningsField: empty list adds nothing", Object.keys(warningsField([])).length === 0 && Object.keys(warningsField(undefined)).length === 0);
}

console.log("== validator: wrapped-text collision + trailing dead space ==");
{
  const tb = (id: string, top: number, height: number, text: string, fontSize: number, extra: any = {}) => ({
    id, type: "text-block",
    responsive: {
      desktop: { styles: { top, left: 80, width: 560, height, fontSize, ...extra } },
      mobile: { styles: { top, left: 20, width: 380, height, fontSize: Math.round(fontSize * 0.7), ...extra } },
    },
    specials: { text, tag: "p" },
  });
  const sect = (children: any[], height = 800) => ({
    page: [{ id: "csec", type: "section", responsive: { desktop: { styles: { height } }, mobile: { styles: { height } } }, children }],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });
  const headline = "The challenges every hotel faces today"; // wraps to 2 lines at 40px/560w

  // 2-line H2 on a 1-line box with the subheading right under the declared box → both checks fire
  const rClash = validatePage(expandSource(sect([tb("h2", 120, 50, headline, 40), tb("sub", 180, 60, "Guests reach out from everywhere and teams are stretched thin.", 16)]), createElement));
  check("collision: 2-line H2 over subheading warned (names the victim)", rClash.warnings.some((w) => w.includes("spill onto") && w.includes("children[1]")), rClash.warnings);
  check("own-box: 2-line H2 on 1-line box no longer slips the one-line slack", rClash.warnings.some((w) => w.includes("children[0]") && w.includes("spill down")), rClash.warnings);

  // properly sized heading + subheading pushed below the estimated bottom → silent
  const rOk = validatePage(expandSource(sect([tb("h2", 120, 112, headline, 40), tb("sub", 260, 60, "Guests reach out from everywhere and teams are stretched thin.", 16)]), createElement));
  check("collision: sized heading + pushed-down subheading → no overlap warning", !rOk.warnings.some((w) => w.includes("spill")), rOk.warnings);

  // layered background rectangle (declared boxes overlap) must NOT count as a victim
  const card = {
    id: "card", type: "group",
    responsive: { desktop: { styles: { top: 100, left: 80, width: 280, height: 300 } }, mobile: { styles: { top: 100, left: 20, width: 280, height: 300 } } },
    children: [
      { id: "bg", type: "rectangle", responsive: { desktop: { styles: { top: 0, left: 0, width: 280, height: 300 } }, mobile: { styles: { top: 0, left: 0, width: 280, height: 300 } } } },
      tb("title", 24, 30, "Guests who book once and disappear forever", 22, { left: 24, width: 232 }),
    ],
  };
  const rCard = validatePage(expandSource(sect([card]), createElement));
  check("collision: layered card background is not a victim", !rCard.warnings.some((w) => w.includes("spill onto") && w.includes("rectangle")), rCard.warnings);

  // UPPERCASE bold hero heading — the case the old 0.55-per-char heuristic
  // under-counted (real Roboto 700 caps are ~0.66em): declared 2-line box,
  // really wraps to 3 lines and spills onto the subtitle below.
  const rCaps = validatePage(expandSource(sect([
    tb("hero", 120, 140, "ÁO VEST NỮ CÔNG SỞ CAO CẤP", 48, { fontWeight: 700, width: 350 }),
    tb("subtitle", 270, 30, "Chất liệu cao cấp — Dáng chuẩn Âu", 18, { width: 350 }),
  ]), createElement));
  check("metrics: UPPERCASE bold heading on a 2-line box → own-box warned", rCaps.warnings.some((w) => w.includes("children[0]") && w.includes("spill down")), rCaps.warnings);
  check("metrics: UPPERCASE heading spill names the subtitle victim", rCaps.warnings.some((w) => w.includes("spill onto") && w.includes("children[1]")), rCaps.warnings);

  // same copy in lowercase regular weight on the same box → fits, stays silent
  const rLower = validatePage(expandSource(sect([
    tb("hero", 120, 140, "Áo vest nữ công sở cao cấp", 48, { width: 350 }),
    tb("subtitle", 270, 30, "Chất liệu cao cấp — Dáng chuẩn Âu", 18, { width: 350 }),
  ]), createElement));
  check("metrics: lowercase regular heading on the same box → no overflow warning", !rLower.warnings.some((w) => w.includes("spill")), rLower.warnings);

  // trailing dead space: section 900 tall, content ends at 300
  const rDead = validatePage(expandSource(sect([tb("h2", 200, 100, "Short", 40)], 900), createElement));
  check("dead space: 600px empty band at section bottom warned", rDead.warnings.some((w) => w.includes("empty band")), rDead.warnings);
  const rTight = validatePage(expandSource(sect([tb("h2", 200, 100, "Short", 40)], 500), createElement));
  check("dead space: 200px bottom padding not flagged", !rTight.warnings.some((w) => w.includes("empty band")), rTight.warnings);
}

console.log("== validator: rectangle svgMask needs a visible background ==");
{
  const SVG = "<svg viewBox='0 0 24 24'><path fill='black' d='M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z'/></svg>";
  const rectIcon = (styles: { desktop: any; mobile: any }, mask: { desktop?: string; mobile?: string }) => ({
    page: [{
      id: "msec", type: "section",
      responsive: { desktop: { styles: { height: 400 } }, mobile: { styles: { height: 400 } } },
      children: [{
        id: "icon1", type: "rectangle",
        responsive: {
          desktop: { styles: { top: 40, left: 80, width: 48, height: 48, ...styles.desktop }, config: mask.desktop ? { svgMask: mask.desktop } : {} },
          mobile: { styles: { top: 40, left: 20, width: 48, height: 48, ...styles.mobile }, config: mask.mobile ? { svgMask: mask.mobile } : {} },
        },
      }],
    }],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });

  // mask on both breakpoints, no background anywhere → invisible on both
  const rNoBg = validatePage(expandSource(rectIcon({ desktop: {}, mobile: {} }, { desktop: SVG, mobile: SVG }), createElement));
  check("svgMask: no styles.background → warned per breakpoint", rNoBg.warnings.filter((w) => w.includes("INVISIBLE")).length === 2, rNoBg.warnings);

  // mask + solid background on both → silent
  const bg = { background: "rgba(34,197,94,1)" };
  const rOkIcon = validatePage(expandSource(rectIcon({ desktop: bg, mobile: bg }, { desktop: SVG, mobile: SVG }), createElement));
  check("svgMask: visible background on both breakpoints → no warning", !rOkIcon.warnings.some((w) => w.includes("svgMask")), rOkIcon.warnings);

  // transparent background counts as invisible
  const tbg = { background: "rgba(34,197,94,0)" };
  const rTransp = validatePage(expandSource(rectIcon({ desktop: tbg, mobile: bg }, { desktop: SVG, mobile: SVG }), createElement));
  check("svgMask: rgba alpha 0 background → warned on that breakpoint", rTransp.warnings.some((w) => w.includes("INVISIBLE") && w.includes("[desktop]")), rTransp.warnings);

  // mask on desktop only → breakpoint-mismatch warning
  const rOneBp = validatePage(expandSource(rectIcon({ desktop: bg, mobile: bg }, { desktop: SVG }), createElement));
  check("svgMask: desktop-only mask → mobile fallback warning", rOneBp.warnings.some((w) => w.includes("desktop only")), rOneBp.warnings);

  // leading whitespace / xml prolog corrupts the renderer's preserveAspectRatio splice
  const rLead = validatePage(expandSource(rectIcon({ desktop: bg, mobile: bg }, { desktop: ` ${SVG}`, mobile: `<?xml version='1.0'?>${SVG}` }), createElement));
  check("svgMask: not starting with '<svg' → warned on both breakpoints", rLead.warnings.filter((w) => w.includes("start EXACTLY with '<svg'")).length === 2, rLead.warnings);

  // no viewBox → cannot scale to the box
  const NOVB = "<svg width='24' height='24'><path fill='black' d='M12 1L3 5v6z'/></svg>";
  const rNoVb = validatePage(expandSource(rectIcon({ desktop: bg, mobile: bg }, { desktop: NOVB, mobile: NOVB }), createElement));
  check("svgMask: missing viewBox → warned", rNoVb.warnings.some((w) => w.includes("no viewBox")), rNoVb.warnings);

  // no shape elements → mask paints nothing
  const EMPTY = "<svg viewBox='0 0 24 24'><defs></defs></svg>";
  const rEmpty = validatePage(expandSource(rectIcon({ desktop: bg, mobile: bg }, { desktop: EMPTY, mobile: EMPTY }), createElement));
  check("svgMask: no shape element → warned", rEmpty.warnings.some((w) => w.includes("no shape element")), rEmpty.warnings);

  // valid SVG passes all the new shape checks silently
  check("svgMask: well-formed icon SVG → no malformed-SVG warnings", !rOkIcon.warnings.some((w) => w.includes("'<svg'") || w.includes("no viewBox") || w.includes("no shape element")), rOkIcon.warnings);

  // svgMask in the wrong place (specials / styles) → placement warning
  const straySrc = rectIcon({ desktop: bg, mobile: bg }, {});
  (straySrc.page[0].children[0] as any).specials = { svgMask: SVG };
  const rStray = validatePage(expandSource(straySrc, createElement));
  check("svgMask: placed in specials → placement warning", rStray.warnings.some((w) => w.includes("ONLY reads responsive.<bp>.config.svgMask")), rStray.warnings);
}

console.log("== validator: pill/badge label alignment ==");
{
  const badge = (textTop: number, textLeft: number, textW: number, textOpts: any = {}, pillOpts: any = {}) => ({
    page: [{
      id: "psec", type: "section",
      responsive: { desktop: { styles: { height: 400 } }, mobile: { styles: { height: 400 } } },
      children: [
        {
          id: "pill", type: "rectangle",
          responsive: {
            desktop: { styles: { top: 100, left: 330, width: 300, height: 36, borderRadius: "999px", background: "rgba(59,130,246,0.15)", ...pillOpts } },
            mobile: { styles: { top: 100, left: 60, width: 300, height: 36, borderRadius: "999px", background: "rgba(59,130,246,0.15)", ...pillOpts } },
          },
        },
        {
          id: "label", type: "text-block",
          responsive: {
            desktop: { styles: { top: textTop, left: textLeft, width: textW, height: 20, fontSize: 14, fontWeight: 600, textAlign: "center", ...textOpts } },
            mobile: { styles: { top: textTop, left: textLeft - 270, width: textW, height: 20, fontSize: 14, fontWeight: 600, textAlign: "center", ...textOpts } },
          },
          specials: { text: "ĐỐI TÁC VẬN CHUYỂN TOÀN QUỐC", tag: "p" },
        },
      ],
    }],
    settings: { title: "t", description: "d", keywords: "k", lang: "vi" },
  });

  // label top eyeballed too low → glyph row sits below the pill center
  const rLow = validatePage(expandSource(badge(115, 340, 280), createElement));
  check("pill: label below pill center → warned with exact top", rLow.warnings.some((w) => w.includes("BELOW") && w.includes("set top = 108")), rLow.warnings);

  // line-box-centered label → silent
  const rMid = validatePage(expandSource(badge(108, 340, 280), createElement));
  check("pill: centered label → no badge warnings", !rMid.warnings.some((w) => w.includes("badge label")), rMid.warnings);

  // label box center 30px right of the pill center
  const rOff = validatePage(expandSource(badge(108, 370, 280), createElement));
  check("pill: label off-center horizontally → warned", rOff.warnings.some((w) => w.includes("badge label") && w.includes("RIGHT")), rOff.warnings);

  // label painted wider than the pill → spills past the rounded ends
  const rWide = validatePage(expandSource(badge(108, 330, 300, { fontSize: 16, fontWeight: 700 }, { width: 220, left: 370 }), createElement));
  check("pill: label wider than pill → spill warning", rWide.warnings.some((w) => w.includes("spills past")), rWide.warnings);
}

console.log("== rehost: external-image URL collect + rewrite (pure, offline) ==");
{
  const src = {
    page: [{
      id: "S1", type: "section",
      responsive: { desktop: { styles: { background: "center center/ cover no-repeat scroll content-box url(https://w.ladicdn.com/s768x703/x/bg.jpg) border-box" } } },
      children: [
        { id: "I1", type: "image", specials: { src: "https://w.ladicdn.com/x/photo.png" } },
        { id: "I2", type: "image", specials: { src: "https://w.ladicdn.com/x/photo.png" } }, // dup → collapses
        { id: "G1", type: "gallery", specials: { media: [{ type: "image", link: "https://w.ladicdn.com/x/a.jpg", linkVideo: "", typeVideo: "youtube" }] } },
        { id: "A1", type: "headline", specials: {}, href: "https://facebook.com/page" }, // href, not image → skip
        { id: "I3", type: "image", specials: { src: "https://statics.pancake.vn/web_content/x/already.jpg" } }, // already hosted → skip
        { id: "I4", type: "image", specials: { src: "https://placehold.co/600x400" } }, // deliberate placeholder → skip
        { id: "SH", type: "shape", specials: { svg: "data:image/svg+xml;utf8,<svg></svg>" } }, // data: → skip
      ],
    }],
  };
  const urls = collectExternalImageUrls(src);
  check("rehost: collects 3 distinct external image URLs", urls.length === 3, urls);
  check("rehost: dedupes the repeated photo.png", urls.filter((u) => u.endsWith("photo.png")).length === 1);
  check("rehost: extracts url() background image", urls.includes("https://w.ladicdn.com/s768x703/x/bg.jpg"));
  check("rehost: extracts gallery item.link", urls.includes("https://w.ladicdn.com/x/a.jpg"));
  check("rehost: skips a non-image href", !urls.includes("https://facebook.com/page"));
  check("rehost: skips an already-hosted pancake URL", !urls.some((u) => u.includes("pancake")));
  check("rehost: skips a placehold.co placeholder", !urls.some((u) => u.includes("placehold")));
  check("rehost: skips a data: URI", !urls.some((u) => u.startsWith("data:")));

  // isRehostableImageUrl edge cases
  check("rehost: data: URI not rehostable", !isRehostableImageUrl("data:image/svg+xml;utf8,<svg>"));
  check("rehost: extension-less URL not rehostable as a plain field", !isRehostableImageUrl("https://w.ladicdn.com/x/noext"));
  check("rehost: .jpg URL rehostable", isRehostableImageUrl("https://w.ladicdn.com/x/p.jpg"));
  check("rehost: ?query after ext still rehostable", isRehostableImageUrl("https://cdn.x/p.png?v=2"));
  // Stitch ↔ webcake bridge: Google Stitch images live on googleusercontent with
  // NO extension — host-recognized so a Stitch clone's specials.src auto-hosts.
  check("rehost: Stitch googleusercontent image (no ext) IS rehostable", isRehostableImageUrl("https://lh3.googleusercontent.com/aida/AP1WRLvcUnHkKPA0hJFi2Yx2"));
  check("rehost: Stitch aida-public image (no ext) IS rehostable", isRehostableImageUrl("https://lh3.googleusercontent.com/aida-public/AB6AXuAh6CcIJ1kE5WUS"));
  check("rehost: extensionless host-recognition is HOST-gated, not blanket", !isRehostableImageUrl("https://example.com/some/path-no-ext"));

  // Collect a Stitch-shaped source (image src with no extension) end-to-end.
  {
    const stitchSrc = {
      page: [{
        id: "S", type: "section",
        children: [
          { id: "HERO", type: "image", specials: { src: "https://lh3.googleusercontent.com/aida/AP1WRLhero" } },
          { id: "AV", type: "image", specials: { src: "https://lh3.googleusercontent.com/aida-public/AB6AXuAvatar" } },
        ],
      }],
    };
    const su = collectExternalImageUrls(stitchSrc);
    check("rehost: collects both extensionless Stitch image URLs", su.length === 2 && su.every((u) => u.includes("googleusercontent.com")), su);
    const sout: any = rewriteImageUrls(stitchSrc, new Map([["https://lh3.googleusercontent.com/aida/AP1WRLhero", "https://statics.pancake.vn/web_content/HERO.jpg"]]));
    check("rehost: rewrites the extensionless Stitch hero src", sout.page[0].children[0].specials.src === "https://statics.pancake.vn/web_content/HERO.jpg");
  }

  // rewrite: deep-clone + replace everywhere, leave original untouched
  const map = new Map([
    ["https://w.ladicdn.com/s768x703/x/bg.jpg", "https://statics.pancake.vn/web_content/BG.jpg"],
    ["https://w.ladicdn.com/x/photo.png", "https://statics.pancake.vn/web_content/PHOTO.png"],
    ["https://w.ladicdn.com/x/a.jpg", "https://statics.pancake.vn/web_content/A.jpg"],
  ]);
  const out: any = rewriteImageUrls(src, map);
  check("rehost: rewrites url() background", out.page[0].responsive.desktop.styles.background.includes("url(https://statics.pancake.vn/web_content/BG.jpg)"));
  check("rehost: rewrites image specials.src", out.page[0].children[0].specials.src === "https://statics.pancake.vn/web_content/PHOTO.png");
  check("rehost: rewrites BOTH duplicate refs", out.page[0].children[1].specials.src === "https://statics.pancake.vn/web_content/PHOTO.png");
  check("rehost: rewrites gallery item.link", out.page[0].children[2].specials.media[0].link === "https://statics.pancake.vn/web_content/A.jpg");
  check("rehost: leaves the source object untouched (deep clone)", (src as any).page[0].children[0].specials.src === "https://w.ladicdn.com/x/photo.png");
  check("rehost: empty map is a no-op identity", rewriteImageUrls(src, new Map()) === src);
}

console.log("== upload_images: local-path detector (pure, offline) ==");
{
  // get_icon_svg name → Iconify candidate mapping (pure; the fetch itself is networked)
  check("icon-svg: ms:<name> → material-symbols outline-first, underscore→hyphen", JSON.stringify(iconifyCandidates("ms:support_agent")) === JSON.stringify(["material-symbols/support-agent-outline", "material-symbols/support-agent"]), iconifyCandidates("ms:support_agent"));
  check("icon-svg: fa:<name> → fa6-solid first with fallbacks", iconifyCandidates("fa:chart-line")[0] === "fa6-solid/chart-line", iconifyCandidates("fa:chart-line"));
  check("icon-svg: bare name assumed Material Symbols", iconifyCandidates("verified")[0] === "material-symbols/verified-outline", iconifyCandidates("verified"));
  check("icon-svg: real Iconify id passes through", iconifyCandidates("mdi:home")[0] === "mdi/home", iconifyCandidates("mdi:home"));
  check("icon-svg: empty ref → no candidates", iconifyCandidates("")?.length === 0, iconifyCandidates(""));

  // isLocalPath: recognised forms
  check("localPath: absolute POSIX /…", isLocalPath("/home/user/photo.jpg"));
  check("localPath: home-dir ~/…", isLocalPath("~/Pictures/logo.png"));
  check("localPath: file:// URI", isLocalPath("file:///tmp/img.png"));
  check("localPath: Windows drive C:\\…", isLocalPath("C:\\Users\\user\\img.jpg"));
  check("localPath: Windows drive C:/…", isLocalPath("C:/Users/user/img.jpg"));
  // isLocalPath: things that must NOT match
  check("localPath: http URL → false", !isLocalPath("https://example.com/img.jpg"));
  check("localPath: data URI → false", !isLocalPath("data:image/png;base64,abc"));
  check("localPath: relative path → false", !isLocalPath("images/photo.jpg"));

  // resolveLocalPath
  const home = (await import("node:os")).homedir();
  check("resolveLocalPath: ~/… expands homedir", resolveLocalPath("~/foo/bar.jpg") === home + "/foo/bar.jpg");
  check("resolveLocalPath: /abs passes through", resolveLocalPath("/abs/path.jpg") === "/abs/path.jpg");
  // file:// resolution is handled by fileURLToPath; test the passthrough for absolute paths
  check("resolveLocalPath: Windows C:\\ passes through", resolveLocalPath("C:\\Users\\x.jpg") === "C:\\Users\\x.jpg");
}

console.log("== upload_images: magic-byte sniffer (pure, offline) ==");
{
  // JPEG: FF D8 FF
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  check("sniff: JPEG magic → image/jpeg", sniffMime(jpegBuf) === "image/jpeg");

  // PNG: 89 50 4E 47
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);
  check("sniff: PNG magic → image/png", sniffMime(pngBuf) === "image/png");

  // GIF: 47 49 46 38
  const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39]);
  check("sniff: GIF magic → image/gif", sniffMime(gifBuf) === "image/gif");

  // BMP: 42 4D
  const bmpBuf = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00]);
  check("sniff: BMP magic → image/bmp", sniffMime(bmpBuf) === "image/bmp");

  // WEBP: RIFF????WEBP
  const webpBuf = Buffer.from([
    0x52, 0x49, 0x46, 0x46,  // RIFF
    0x00, 0x00, 0x00, 0x00,  // file size (ignored)
    0x57, 0x45, 0x42, 0x50,  // WEBP
  ]);
  check("sniff: WEBP magic → image/webp", sniffMime(webpBuf) === "image/webp");

  // unknown bytes
  const unknownBuf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  check("sniff: unknown bytes → undefined", sniffMime(unknownBuf) === undefined);

  // too-short buffer
  check("sniff: 2-byte buffer → undefined", sniffMime(Buffer.from([0xff, 0xd8])) === undefined);
}

console.log("== upload_images: localContentType (ext + magic, pure offline) ==");
{
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const pngBuf  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);
  const unknownBuf = Buffer.from([0x00, 0x01, 0x02, 0x03]);

  // magic wins over extension when they agree
  check("localContentType: .jpg + JPEG magic → image/jpeg", localContentType("jpg", jpegBuf) === "image/jpeg");
  check("localContentType: .png + PNG magic → image/png",   localContentType("png", pngBuf)  === "image/png");

  // magic wins over (wrong) extension
  check("localContentType: .png ext but JPEG magic → image/jpeg (magic wins)", localContentType("png", jpegBuf) === "image/jpeg");

  // extension fallback when magic is unknown
  check("localContentType: unknown magic + .png ext → image/png (ext fallback)", localContentType("png", unknownBuf) === "image/png");
  check("localContentType: unknown magic + .svg ext → image/svg+xml (ext fallback)", localContentType("svg", unknownBuf) === "image/svg+xml");

  // both unknown → undefined
  check("localContentType: unknown magic + unknown ext → undefined", localContentType("xyz", unknownBuf) === undefined);
}

console.log(`\n${failures === 0 ? "ALL GOOD" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
