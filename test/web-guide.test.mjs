// The marketing page must describe the current install and carry the 4-stop scene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guideHtml } from "../dist/web-guide.js";

for (const lang of ["vi", "en"]) {
  const html = guideHtml("https://example.test", lang);

  test(`${lang}: install steps say click Connect, with no environment or app picking`, () => {
    assert.match(html, lang === "vi" ? /Bấm “Kết nối”/ : /Click “Connect”/);
    assert.doesNotMatch(html, /Follow the prompts|Làm theo hướng dẫn hiện ra|--env prod/);
  });

  test(`${lang}: the scene names the four stops and its steps work without three.js`, () => {
    assert.match(html, /id="scene"/);
    assert.ok(html.includes("<b>Webcake MCP</b>"));
    assert.equal((html.match(/class="sc-step"/g) || []).length, 5);
    assert.match(html, /three@\d+\.\d+\.\d+\/build\/three\.module\.min\.js/); // pinned, never "latest"
  });
}
