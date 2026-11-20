// A page that already carries an error (e.g. a stored checkbox → [NOT_RENDERED]) must stay editable
// through every save path, drafts included: finishing a kind:'update' draft refuses only NEW errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { putDraft } from "../dist/persistence/draft-cache.js";
import { landingDomain as D } from "../dist/domains/landing/index.js";

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  const c = new Client({ name: "t", version: "0" });
  await c.connect(b);
  return c;
}
const call = async (c, name, args) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);

function pageWithCheckbox() {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  const form = D.presetElement("form");
  form.children.push(D.createElement("checkbox"));
  sec.children = [form];
  src.page = [sec];
  const s = D.expand(src);
  D.autofixLayout(s);
  return s;
}

test("update draft: an error the live page already had does not block; a new one does", async () => {
  const src = pageWithCheckbox();
  const prior = D.validate(src).errors;
  assert.ok(prior.some((e) => e.startsWith("[NOT_RENDERED]")));
  const c = await client();
  const draft_id = await putDraft({ source: src, kind: "update", page_id: "pg1", prior_errors: prior });
  const ok = await call(c, "patch_page", { draft_id, dry_run: true, patches: [] });
  assert.equal(ok.dry_run, true, JSON.stringify(ok).slice(0, 400));
  // a second checkbox is a NEW error
  const form = src.page[0].children[0];
  const bad = await call(c, "patch_page", { draft_id, dry_run: true, patches: [{ op: "add", parent_id: form.id, element: { type: "checkbox", id: "cbnew01", specials: { field_name: "agree2" } } }] });
  assert.equal(bad.reason, "validation_failed");
  assert.ok(bad.errors.every((e) => /cbnew01|children\[\d+\]/.test(e)) && bad.pre_existing_errors >= 1, JSON.stringify(bad).slice(0, 600));
  // without prior_errors (a create draft) the old rule stands: every error blocks
  const create = await putDraft({ source: pageWithCheckbox() });
  assert.equal((await call(c, "patch_page", { draft_id: create, dry_run: true, patches: [] })).reason, "validation_failed");
});
