/**
 * Liquid-glass skin + the 3D "how MCP works" scene for the marketing page.
 *
 * - GLASS_CSS is appended to the page's <style>, so it wins over the base rules.
 * - sceneHtml(lang) is plain, readable steps; without WebGL (or if the CDN fails) that
 *   list stays on its own and nothing is lost.
 * - SCENE_JS loads three.js from jsDelivr only when the section nears the viewport, so
 *   the page itself stays one light HTML response. T (0..5) is the single timeline:
 *   every visual is a pure function of T, so clicking a step can jump either way.
 *
 * Kept identical in webcake-storefront-mcp and webcake-landing-mcp except COPY/ON_ACCENT.
 * No backticks or dollar-brace inside SCENE_JS: it is pasted into a template literal.
 */

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js";
const ON_ACCENT = "#06210f"; // text on the brand button
const TEXT_ACCENT = "#0c6a30"; // brand-coloured text on light glass, dark enough for 4.5:1

const COPY = {
  "vi": {
    "aria": "Cách MCP hoạt động, từng bước",
    "pause": "Tạm dừng",
    "resume": "Tiếp tục",
    "replay": "Xem lại",
    "tags": [
      {
        "t": "Bạn",
        "s": "ý tưởng của bạn"
      },
      {
        "t": "Trợ lý AI",
        "s": "Claude · Cursor · Codex…"
      },
      {
        "t": "Webcake MCP",
        "s": "cầu nối thông minh"
      },
      {
        "t": "Webcake",
        "s": "trang web thật"
      }
    ],
    "steps": [
      {
        "t": "Bạn nói điều mình muốn",
        "d": "Nhắn trong Claude, Cursor… như nhắn cho đồng nghiệp: “Làm trang bán áo thun, tông cam ấm.”"
      },
      {
        "t": "AI tìm đúng công cụ qua MCP",
        "d": "MCP là cầu nối cho AI biết Webcake làm được những gì, như tạo trang hay thêm một mục, và phải yêu cầu thế nào."
      },
      {
        "t": "Webcake làm bằng tài khoản của bạn",
        "d": "Bạn chỉ cần bấm Kết nối một lần. AI không cần biết mật khẩu của bạn."
      },
      {
        "t": "Trang được dựng lên từng phần",
        "d": "Ảnh lớn, sản phẩm, nút đặt hàng lần lượt được lưu vào Webcake. Đây là trang thật, bạn vẫn sửa được trong trình chỉnh sửa."
      },
      {
        "t": "AI gửi link cho bạn xem",
        "d": "Chưa ưng chỗ nào thì nói tiếp, AI sửa đúng chỗ đó rồi gửi lại."
      }
    ]
  },
  "en": {
    "aria": "How MCP works, step by step",
    "pause": "Pause",
    "resume": "Resume",
    "replay": "Replay",
    "tags": [
      {
        "t": "You",
        "s": "your idea"
      },
      {
        "t": "AI assistant",
        "s": "Claude · Cursor · Codex…"
      },
      {
        "t": "Webcake MCP",
        "s": "the smart bridge"
      },
      {
        "t": "Webcake",
        "s": "a real page"
      }
    ],
    "steps": [
      {
        "t": "You say what you want",
        "d": "Type in Claude, Cursor… like messaging a colleague: “Make a T-shirt sales page in warm orange.”"
      },
      {
        "t": "The AI finds the right tool through MCP",
        "d": "MCP is the bridge that tells the AI what Webcake can do, like creating a page or adding a section, and how to ask for it."
      },
      {
        "t": "Webcake does the work on your account",
        "d": "You only click Connect once. The AI never needs your password."
      },
      {
        "t": "The page goes up section by section",
        "d": "The big image, products and order button are saved to Webcake one by one. It is a real page you can keep editing yourself."
      },
      {
        "t": "The AI sends you the link",
        "d": "Not quite right? Say so, and the AI changes just that part and sends it back."
      }
    ]
  }
};

export function sceneHtml(lang: "vi" | "en"): string {
  const c = COPY[lang];
  return `<section class="sc" id="scene" aria-label="${c.aria}" data-pause="${c.pause}" data-resume="${c.resume}" data-replay="${c.replay}">
    <div class="sc-stage" aria-hidden="true">
      <canvas></canvas>
      ${c.tags.map((t) => `<span class="sc-tag"><b>${t.t}</b><small>${t.s}</small></span>`).join("")}
    </div>
    <div class="sc-panel glass">
      <ol class="sc-steps">
        ${c.steps
          .map(
            (s, i) =>
              `<li${i === 0 ? ' class="cur"' : ""}><button type="button" class="sc-step"><span class="sc-n">${i + 1}</span><span>${s.t}</span></button><div class="sc-dw"><p>${s.d}</p></div></li>`,
          )
          .join("\n        ")}
      </ol>
      <button type="button" class="sc-ctl" hidden>${c.pause}</button>
    </div>
  </section>`;
}

export const GLASS_CSS = `
  /* ── Liquid glass ─────────────────────────────────────────────────────────
     The page-builder grid and colour field sit behind everything, so the glass has
     something to bend. Refraction itself is added by SCENE_JS on Chromium; other
     browsers keep the blur + bright rim, which is still legible glass. */
  :root{--on-g:${ON_ACCENT};--btn-a:color-mix(in srgb,var(--g) 94%,#000);--btn-b:color-mix(in srgb,var(--g) 84%,#000);--g7:${TEXT_ACCENT};--ic-fg:${TEXT_ACCENT};--ink:#0d1c15;--mut:#3b4942;--glass:rgba(255,255,255,.74);--glass-strong:rgba(255,255,255,.9);
    --rim:rgba(255,255,255,.9);--rim-soft:rgba(255,255,255,.4);--glow:rgba(255,255,255,.55);--amber:#f5a524;
    --drop:0 1px 1px rgba(16,40,30,.04),0 22px 44px -26px rgba(16,40,30,.38);--navbg:transparent}
  @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--on-g:#04241a;--btn-a:var(--g);--btn-b:color-mix(in srgb,var(--g) 94%,#000);--mut:#bccbc3;--glass:rgba(17,25,21,.76);--glass-strong:rgba(14,21,18,.9);
    --rim:rgba(255,255,255,.24);--rim-soft:rgba(255,255,255,.08);--glow:rgba(255,255,255,.1);
    --drop:0 1px 1px rgba(0,0,0,.3),0 24px 48px -26px rgba(0,0,0,.85)}}
  :root[data-theme="dark"]{--on-g:#04241a;--btn-a:var(--g);--btn-b:color-mix(in srgb,var(--g) 94%,#000);--mut:#bccbc3;--glass:rgba(17,25,21,.76);--glass-strong:rgba(14,21,18,.9);
    --rim:rgba(255,255,255,.24);--rim-soft:rgba(255,255,255,.08);--glow:rgba(255,255,255,.1);
    --drop:0 1px 1px rgba(0,0,0,.3),0 24px 48px -26px rgba(0,0,0,.85)}
  body::after{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
    background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
    background-size:46px 46px;-webkit-mask:none;mask:none;opacity:.45}
  .blobs b{filter:blur(80px);opacity:.26}
  .blobs b:nth-child(1){width:760px;height:760px;right:4%;top:-220px}
  .blobs b:nth-child(2){width:680px;height:680px;left:6%;bottom:-200px}
  .blobs b:nth-child(3){width:520px;height:520px;left:30%;top:30%;opacity:.16;
    background:radial-gradient(circle,var(--amber),transparent 70%);animation:drift1 56s ease-in-out infinite}
  .glass,.iconbtn,.langsw,.btn.ghost,.btn.ghost:hover,.nav{background-color:var(--glass);border:1px solid var(--rim-soft);
    -webkit-backdrop-filter:blur(20px) saturate(175%);backdrop-filter:blur(20px) saturate(175%);
    box-shadow:inset 0 1px 0 var(--rim),inset 0 -1px 0 var(--rim-soft),var(--drop)}
  .glass{border-radius:22px;background-image:none}
  .glass.card:hover,.uses li.glass:hover,.glass:hover{transform:none;border-color:var(--rim-soft);
    box-shadow:inset 0 1px 0 var(--rim),inset 0 -1px 0 var(--rim-soft),var(--drop)}
  /* The highlight follows the pointer (--mx/--my from SCENE_JS): light moving on a surface. */
  @media(hover:hover){.glass:hover{background-image:radial-gradient(280px circle at var(--mx,50%) var(--my,0%),var(--glow),transparent 72%)}}
  .tip{background:var(--glass);border-color:var(--rim-soft);border-radius:16px}
  /* A long command scrolls inside its own box instead of stretching the steps past the phone screen. */
  .steps{grid-template-columns:minmax(0,1fr)}
  .btn{color:var(--on-g);border-radius:999px;border:0;background:linear-gradient(180deg,var(--btn-a),var(--btn-b));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.45),inset 0 -8px 12px -8px rgba(0,0,0,.28),0 12px 24px -14px var(--g)}
  .btn:hover{transform:none;filter:brightness(1.07);background:linear-gradient(180deg,var(--btn-a),var(--btn-b))}
  .btn:active{transform:scale(.97)}
  .btn.ghost,.btn.ghost:hover{background-image:none;color:var(--ink);filter:none}
  .btn:focus-visible,.langsw:focus-visible,.iconbtn:focus-visible,.nav a:focus-visible{outline:2px solid var(--g);outline-offset:2px}
  .iconbtn{border-radius:50%}
  .new{color:var(--on-g);background:var(--btn-a);animation:none}
  .nav{position:sticky;top:10px;margin:18px 0 6px;padding:6px;border-radius:999px}
  /* ── The scene: wider than the text column, panel floats over the canvas ── */
  .sc{position:relative;width:min(1180px,calc(100vw - 32px));margin-left:calc(50% - min(590px,calc(50vw - 16px)))}
  .sc-stage{display:none;position:relative;overflow:hidden;height:clamp(440px,46vw,600px)}
  .js .sc.on .sc-stage{display:block}
  .sc-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .45s ease}
  /* Canvas + labels wait for the first drawn frame, so the labels never flash stacked at 0,0. */
  .sc-tag{opacity:0}
  .sc.ready .sc-stage canvas,.sc.ready .sc-tag{opacity:1}
  .sc-tag{position:absolute;left:0;top:0;padding:5px 13px 6px;border-radius:14px;text-align:center;white-space:nowrap;line-height:1.25;
    color:var(--ink);background:var(--glass-strong);box-shadow:inset 0 1px 0 var(--rim),0 8px 18px -12px rgba(0,0,0,.5);
    -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);pointer-events:none;will-change:transform;transition:color .25s ease,opacity .45s ease}
  .sc-tag b{display:block;font-size:.84rem}
  .sc-tag small{display:block;font-size:.72rem;font-weight:500;color:var(--mut)}
  .sc-tag.on b{color:var(--g7)}
  .sc-panel{padding:12px;margin-top:12px}
  @media(min-width:1040px){.js .sc.on .sc-panel{position:absolute;left:0;top:26px;width:372px;margin:0;z-index:2}}
  @media(max-width:1039px){.sc{width:100%;margin-left:0}}
  .sc-steps{list-style:none;margin:0;padding:0;display:grid;gap:2px}
  .sc-step{display:flex;gap:11px;align-items:center;width:100%;padding:8px;border:0;border-radius:13px;background:none;color:inherit;
    font:inherit;font-weight:700;font-size:.95rem;line-height:1.3;text-align:left;cursor:pointer;transition:background .15s ease,color .15s ease}
  .sc-step:hover{background:rgba(127,160,140,.14)}
  .sc-step:focus-visible,.sc-ctl:focus-visible{outline:2px solid var(--g);outline-offset:1px}
  html:not(.js) .sc-step,.sc.off .sc-step{pointer-events:none}
  .sc-n{flex:0 0 auto;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:.84rem;font-weight:800;
    color:var(--ic-fg);background:rgba(127,160,140,.18);transition:background .2s ease,color .2s ease}
  .js .sc.on .cur .sc-step{color:var(--g7)}
  .js .sc.on .cur .sc-n{background:var(--btn-a);color:var(--on-g)}
  .sc-dw{display:grid;grid-template-rows:1fr;transition:grid-template-rows .3s cubic-bezier(.2,.7,.2,1)}
  .js .sc.on li:not(.cur) .sc-dw{grid-template-rows:0fr}
  .sc-dw p{overflow:hidden;min-height:0;margin:0;padding-left:47px;padding-right:8px;font-size:.9rem;color:var(--mut)}
  .sc-dw p::after{content:"";display:block;height:8px}
  .sc-ctl{display:block;margin:4px 8px 2px auto;padding:5px 10px;border:0;border-radius:999px;background:none;cursor:pointer;
    color:var(--g7);font:inherit;font-size:.84rem;font-weight:700}
  .sc-ctl:hover{background:rgba(127,160,140,.14)}
  .sc-ctl[hidden]{display:none}
  /* Reserve the play/pause row before three.js arrives so the panel doesn't grow. */
  @media(prefers-reduced-motion:no-preference){.js .sc.on .sc-ctl[hidden]{display:block;visibility:hidden}}
  @media(max-width:639px){.sc-stage{height:520px}.sc-tag small{font-size:.68rem}.nav{margin-left:0;margin-right:0}}
  @media(prefers-reduced-motion:reduce){.sc-dw,.sc-step,.sc-n,.sc-tag,.sc-stage canvas{transition:none}}
  @media(prefers-reduced-transparency:reduce){
    .glass,.iconbtn,.langsw,.btn.ghost,.btn.ghost:hover,.nav,.tip,.sc-tag{background-color:var(--card);background-image:none;
      -webkit-backdrop-filter:none;backdrop-filter:none}
  }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    .glass,.iconbtn,.langsw,.btn.ghost,.btn.ghost:hover,.nav,.tip,.sc-tag{background-color:var(--card)}
  }
`;

export const SCENE_JS = String.raw`
(function(){
  var html=document.documentElement;
  function mq(q){return !!(window.matchMedia&&matchMedia(q).matches);}

  // ── Glass light: the highlight follows the pointer ──
  document.addEventListener('pointermove',function(e){
    var g=e.target&&e.target.closest&&e.target.closest('.glass');
    if(!g)return;
    var r=g.getBoundingClientRect();
    g.style.setProperty('--mx',(e.clientX-r.left)+'px');
    g.style.setProperty('--my',(e.clientY-r.top)+'px');
  },{passive:true});

  // ── Glass refraction: an edge-lens displacement map per element ──
  // Only Chromium applies an SVG filter inside backdrop-filter; userAgentData is Chromium-only.
  var chromium=!!(navigator.userAgentData&&navigator.userAgentData.brands&&navigator.userAgentData.brands.some(function(b){return /Chromium/.test(b.brand);}));
  function lens(el,n){
    var NS='http://www.w3.org/2000/svg',id='lg-lens-'+n;
    var svg=document.createElementNS(NS,'svg');
    svg.setAttribute('aria-hidden','true');svg.style.cssText='position:absolute;width:0;height:0';
    var f=document.createElementNS(NS,'filter');
    f.setAttribute('id',id);f.setAttribute('filterUnits','userSpaceOnUse');f.setAttribute('color-interpolation-filters','sRGB');
    f.setAttribute('x','0');f.setAttribute('y','0');
    var im=document.createElementNS(NS,'feImage');im.setAttribute('x','0');im.setAttribute('y','0');im.setAttribute('preserveAspectRatio','none');im.setAttribute('result','map');
    var d=document.createElementNS(NS,'feDisplacementMap');d.setAttribute('in','SourceGraphic');d.setAttribute('in2','map');
    d.setAttribute('xChannelSelector','R');d.setAttribute('yChannelSelector','G');d.setAttribute('scale','46');
    f.appendChild(im);f.appendChild(d);svg.appendChild(f);document.body.appendChild(svg);
    var pw=0,ph=0;
    function draw(){
      var w=el.offsetWidth,h=el.offsetHeight;
      if(!w||!h||(w===pw&&h===ph))return;
      pw=w;ph=h;
      var cw=Math.ceil(w/2),ch=Math.ceil(h/2),cv=document.createElement('canvas');cv.width=cw;cv.height=ch;
      var c=cv.getContext('2d'),img=c.createImageData(cw,ch),D=img.data;
      var r=Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||0,h/2)/2,band=Math.min(16,ch/2);
      for(var y=0;y<ch;y++)for(var x=0;x<cw;x++){
        // Rounded-rect signed distance: strongest bend at the rim, none past the band.
        var ax=x+.5-cw/2,ay=y+.5-ch/2,qx=Math.abs(ax)-cw/2+r,qy=Math.abs(ay)-ch/2+r;
        var dist=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
        var t=Math.max(0,Math.min(1,1+dist/band)),m=t*t,nx=0,ny=0;
        if(qx>0&&qy>0){var l=Math.hypot(qx,qy)||1;nx=qx/l;ny=qy/l;}else if(qx>qy){nx=1;}else{ny=1;}
        nx*=ax<0?-1:1;ny*=ay<0?-1:1;
        var i=(y*cw+x)*4;
        D[i]=128-nx*m*127;D[i+1]=128-ny*m*127;D[i+2]=128;D[i+3]=255;
      }
      c.putImageData(img,0,0);
      f.setAttribute('width',w);f.setAttribute('height',h);
      im.setAttribute('width',w);im.setAttribute('height',h);im.setAttribute('href',cv.toDataURL());
    }
    draw();
    var bf='url(#'+id+') blur(14px) saturate(160%)';
    el.style.backdropFilter=bf;
    if(window.ResizeObserver)new ResizeObserver(draw).observe(el);
  }
  if(chromium&&!mq('(prefers-reduced-transparency: reduce)')){
    var lensEls=document.querySelectorAll('.nav,.sc-panel');
    for(var li=0;li<lensEls.length;li++)lens(lensEls[li],li);
  }

  // ── The scene ──
  var root=document.getElementById('scene');
  if(!root||!window.IntersectionObserver)return;
  function hasGL(){try{return !!document.createElement('canvas').getContext('webgl2');}catch(e){return false;}}
  if(!hasGL()){root.classList.add('off');return;}
  root.classList.add('on'); // reserved now so nothing jumps when three.js arrives
  var stage=root.querySelector('.sc-stage'),canvas=root.querySelector('canvas'),ctl=root.querySelector('.sc-ctl');
  var tags=[].slice.call(root.querySelectorAll('.sc-tag')),items=[].slice.call(root.querySelectorAll('.sc-steps li'));
  var loader=new IntersectionObserver(function(es){
    if(!es[0].isIntersecting)return;
    loader.disconnect();
    import('${THREE_URL}').then(start).catch(function(){root.classList.remove('on');root.classList.add('off');});
  },{rootMargin:'320px'});
  loader.observe(root);

  function start(THREE){
    var reduced=mq('(prefers-reduced-motion: reduce)');
    var lite=(navigator.hardwareConcurrency||8)<=4||window.innerWidth<640;
    var STEP=3.2,T=reduced?5:0,hold=5,playing=false,visible=false,touched=false,raf=0,last=0,curStep=-1;
    var css=getComputedStyle(html),ACCENT=new THREE.Color((css.getPropertyValue('--g')||'#1DB954').trim()),AMBER=new THREE.Color(0xf5a524);

    var renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,lite?1.5:2));
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    var scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,2,.1,60);
    camera.position.set(0,0,11);

    // Soft studio lighting, built here so there is no HDR file to download.
    var envScene=new THREE.Scene();
    function softbox(hex,power,w,h,p){
      var c=new THREE.Color(hex).multiplyScalar(power);
      var m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));
      m.position.set(p[0],p[1],p[2]);m.lookAt(0,0,0);envScene.add(m);
    }
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(30,16,12),new THREE.MeshBasicMaterial({color:0x26362f,side:THREE.BackSide})));
    softbox(0xffffff,9,14,5,[0,12,6]);softbox(0xffffff,5,4,12,[-12,0,6]);softbox(0xffe2b0,5,4,10,[12,2,5]);softbox(ACCENT.getHex(),4,12,4,[0,-11,3]);
    var pmrem=new THREE.PMREMGenerator(renderer);
    scene.environment=pmrem.fromScene(envScene,.03).texture;pmrem.dispose();
    var sun=new THREE.DirectionalLight(0xffffff,1.1);sun.position.set(3,6,8);scene.add(sun);

    // Clear in the middle, bright at the edges, like real glass seen against a page. three's
    // transmission can't see the page behind a transparent canvas (it turned grey), so edge
    // opacity comes from a Fresnel term instead; also far cheaper on phones.
    function glass(){
      var m=new THREE.MeshPhysicalMaterial({color:ACCENT.clone().lerp(new THREE.Color(0xffffff),.72),transparent:true,opacity:.14,roughness:.06,clearcoat:1,clearcoatRoughness:.05,depthWrite:false,envMapIntensity:1.5});
      m.onBeforeCompile=function(sh){
        sh.fragmentShader=sh.fragmentShader.replace('#include <opaque_fragment>',
          'diffuseColor.a=mix(diffuseColor.a,.8,pow(1.0-saturate(dot(normalize(vViewPosition),normal)),2.6));\n#include <opaque_fragment>');
      };
      return m;
    }
    function solid(color,rough){return new THREE.MeshStandardMaterial({color:color,emissive:color,emissiveIntensity:.12,roughness:rough==null?.32:rough});}
    function rrShape(w,h,r,tail){
      var s=new THREE.Shape(),x=-w/2,y=-h/2;
      s.moveTo(x+r,y);
      if(tail){s.lineTo(x+r+.02,y-.3);s.lineTo(x+r+.42,y);}
      s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
    }
    function slab(w,h,r,d,tail){
      var b=Math.min(.07,d*.5+.015);
      return new THREE.ExtrudeGeometry(rrShape(w-2*b,h-2*b,Math.max(.01,r-b),tail),{depth:d,bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:5,curveSegments:14}).center();
    }
    function mesh(g,m,p,parent){var o=new THREE.Mesh(g,m);if(p)o.position.set(p[0],p[1],p[2]);(parent||scene).add(o);return o;}

    // The four stops are the ones the page has always named: you, the AI, MCP, Webcake.
    // Stop 1: you, the idea. A glass light bulb that lights up.
    var bulb=new THREE.Group();scene.add(bulb);
    var bp=[new THREE.Vector2(.001,.84)];
    for(var bi=1;bi<=18;bi++){var ba=Math.PI/2-bi/18*(Math.PI/2+.85);bp.push(new THREE.Vector2(.64*Math.cos(ba),.2+.64*Math.sin(ba)));}
    bp.push(new THREE.Vector2(.3,-.5),new THREE.Vector2(.3,-.62));
    mesh(new THREE.LatheGeometry(bp.reverse(),48),glass(),[0,0,0],bulb);
    var capM=solid(0x9fb0a9,.45),fil=solid(AMBER,.2);
    mesh(new THREE.CylinderGeometry(.29,.29,.1,32),capM,[0,-.68,0],bulb);
    mesh(new THREE.CylinderGeometry(.25,.25,.1,32),capM,[0,-.8,0],bulb);
    mesh(new THREE.CylinderGeometry(.13,.06,.1,24),capM,[0,-.91,0],bulb);
    mesh(new THREE.CylinderGeometry(.025,.05,.7,12),capM,[0,-.2,0],bulb);
    mesh(new THREE.SphereGeometry(.14,24,16),fil,[0,.2,0],bulb);

    // Stop 2: the AI assistant, the brain icon drawn in tubes, inside a chat bubble.
    var bubble=new THREE.Group();scene.add(bubble);
    mesh(slab(1.95,1.5,.46,.3,true),glass(),[0,0,0],bubble);
    var brainM=solid(ACCENT);
    function iconTube(d,k,rad,mat,parent){
      // The browser walks the SVG path, so arcs need no parser of ours.
      var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);
      var L=p.getTotalLength(),pts=[];
      for(var i=0;i<90;i++){var q=p.getPointAtLength(L*i/90);pts.push(new THREE.Vector3((q.x-12)*k,(12-q.y)*k,0));}
      return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,true),240,rad,8,true),mat,[0,.14,.04],parent);
    }
    iconTube('M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z',.054,.034,brainM,bubble);
    iconTube('M12 5a3 3 0 1 1 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z',.054,.034,brainM,bubble);

    // Stop 3: Webcake MCP, the bridge: a ring of tools the AI can reach for, around the server icon.
    var ringG=new THREE.Group();scene.add(ringG);
    mesh(new THREE.TorusGeometry(.92,.14,32,96),glass(),[0,0,0],ringG);
    var srvM=solid(ACCENT);
    [.17,-.17].forEach(function(y){
      mesh(slab(.92,.27,.08,.1),srvM,[0,y,0],ringG);
      mesh(new THREE.SphereGeometry(.04,12,8),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),[-.3,y,.11],ringG);
    });
    var toolM=solid(ACCENT.clone().lerp(new THREE.Color(0xffffff),.28)),pick=solid(AMBER);
    var tools=[0,1,2,3,4,5].map(function(i){return mesh(slab(.24,.24,.07,.07),i===0?pick:toolM,[0,0,0],ringG);});

    // Stop 4: Webcake and the real page. The page is built below; this is the logo in 3D on its
    // corner: the official W and peach dot on a green tile inside clear glass.
    var page=new THREE.Group();scene.add(page);page.rotation.y=-.22;
    var W_PATH='M14.3011 11.3523C14.395 12.3191 14.4157 12.0816 15.0571 13.6768C15.0571 21.9423 13.5334 16.5399 12.2589 13.6732C11.4363 11.7505 10.7943 9.30526 8.74858 9.1988C7.57201 9.1623 6.51244 9.98392 6.47107 11.062C6.44377 11.4475 6.49804 11.8319 6.64075 12.191C7.2016 13.6024 8.65083 17.1402 8.92789 17.7945C9.36942 18.8396 9.77116 19.8691 10.1854 20.8761C10.6124 21.9109 11.0522 22.8274 12.5529 22.8274H12.8564C13.9412 22.8274 15.026 21.8587 15.4402 21.1763C16.0707 20.1346 15.8417 17.4106 16.1743 16.3166C16.2961 16.756 17.7389 20.1485 17.9731 20.6986C18.3873 21.6795 18.8071 22.8271 20.23 22.8271H20.686C21.8473 22.8271 22.8155 21.7767 22.8155 20.6483V20.5753C22.7647 19.951 20.713 15.1116 20.3587 14.2785C19.9081 13.2212 19.5137 12.2125 19.0666 11.1569C18.6251 10.1118 18.1725 9.17255 16.6572 9.17255H16.4281C15.2651 9.17255 14.3004 10.209 14.3004 11.3513L14.3011 11.3523Z';
    function svgShape(d){
      // Just the commands this path uses. y flips because SVG grows downward; the logo is 32 units wide.
      var sh=new THREE.Shape(),m=d.match(/[MCHVLZ]|-?[0-9.]+/g),i=0,x=0,y=0;
      function n(){return parseFloat(m[i++])-16;}
      while(i<m.length){
        var c=m[i++];
        if(c==='M'){x=n();y=n();sh.moveTo(x,-y);}
        else if(c==='L'){x=n();y=n();sh.lineTo(x,-y);}
        else if(c==='H'){x=n();sh.lineTo(x,-y);}
        else if(c==='V'){y=n();sh.lineTo(x,-y);}
        else if(c==='C'){var a1=n(),b1=n(),a2=n(),b2=n();x=n();y=n();sh.bezierCurveTo(a1,-b1,a2,-b2,x,-y);}
      }
      return sh;
    }
    var logo=new THREE.Group();page.add(logo);logo.position.set(-.86,1.02,.34);logo.scale.setScalar(.62);
    mesh(slab(1.98,1.98,.48,.3),glass(),[0,0,0],logo);
    var tileG=slab(1.72,1.72,.4,.1),tileP=tileG.attributes.position,tileC=new Float32Array(tileP.count*3);
    var topC=new THREE.Color(0x3FBB57),botC=new THREE.Color(0x108B67),mixC=new THREE.Color();
    for(var ti=0;ti<tileP.count;ti++){mixC.copy(botC).lerp(topC,(tileP.getY(ti)+.86)/1.72);mixC.toArray(tileC,ti*3);}
    tileG.setAttribute('color',new THREE.BufferAttribute(tileC,3));
    var tileM=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.28,emissive:0x108B67,emissiveIntensity:.12});
    mesh(tileG,tileM,[0,0,0],logo);
    var mark=new THREE.Group(),K=1.78/32;mark.scale.setScalar(K);mark.position.z=.15;logo.add(mark);
    var wM=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:.6,roughness:.22});
    mesh(new THREE.ExtrudeGeometry(svgShape(W_PATH),{depth:1.3,bevelEnabled:true,bevelSize:.22,bevelThickness:.4,bevelSegments:5,curveSegments:16}),wM,[0,0,0],mark);
    var dotP=solid(0xFFD591,.2),peach=mesh(new THREE.SphereGeometry(2.16,32,24),dotP,[23.4118-16,16-11.3277,1.1],mark);peach.scale.z=.62;

    // The page itself, with sections that arrive one by one.
    mesh(slab(1.9,2.3,.2,.1),glass(),[0,0,0],page);
    mesh(slab(1.5,.09,.04,.015),solid(0x9fb0a9,.5),[0,.94,.1],page);
    var soft=solid(ACCENT.clone().lerp(new THREE.Color(0xffffff),.45));
    var built=[
      {o:mesh(slab(1.5,.68,.1,.035),solid(ACCENT),[0,.43,.1],page),a:0,b:.38},
      {o:mesh(slab(.45,.45,.08,.035),soft,[-.52,-.27,.1],page),a:.22,b:.54},
      {o:mesh(slab(.45,.45,.08,.035),soft,[0,-.27,.1],page),a:.3,b:.62},
      {o:mesh(slab(.45,.45,.08,.035),soft,[.52,-.27,.1],page),a:.38,b:.7},
      {o:mesh(slab(.86,.22,.11,.035),solid(AMBER),[0,-.8,.1],page),a:.62,b:.95}
    ];
    built.forEach(function(s){s.z=s.o.position.z;});

    // The route the request travels, and the part of it already lit.
    var wireBase=new THREE.MeshStandardMaterial({color:0x7f9a8c,transparent:true,opacity:.34,roughness:.3});
    var wireLit=new THREE.MeshBasicMaterial({color:ACCENT,toneMapped:false}),wireRet=new THREE.MeshBasicMaterial({color:AMBER,toneMapped:false});
    var base=mesh(new THREE.BufferGeometry(),wireBase),lit=mesh(new THREE.BufferGeometry(),wireLit),ret=mesh(new THREE.BufferGeometry(),wireRet);
    var curve,lengths,stations=[bulb,bubble,ringG,page];

    var sprite=(function(){
      var c=document.createElement('canvas');c.width=c.height=64;
      var g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);
      r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,255,255,.55)');r.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle=r;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
    })();
    var haloM=new THREE.SpriteMaterial({map:sprite,color:ACCENT,transparent:true,depthWrite:false}),halo=new THREE.Sprite(haloM);halo.scale.setScalar(.62);scene.add(halo);
    var bulbHaloM=new THREE.SpriteMaterial({map:sprite,color:AMBER,transparent:true,depthWrite:false,opacity:0}),bulbHalo=new THREE.Sprite(bulbHaloM);
    bulbHalo.scale.setScalar(1.9);bulbHalo.position.y=.2;bulb.add(bulbHalo);
    var headM=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),head=mesh(new THREE.SphereGeometry(.085,24,16),headM);
    var trailM=new THREE.MeshBasicMaterial({color:ACCENT,toneMapped:false,transparent:true,opacity:.6});
    var trail=[1,2,3,4,5].map(function(k){return mesh(new THREE.SphereGeometry(.06-.008*k,12,8),trailM);});

    var mode='',W=0,H=0,panelW=0,scaleS=1;
    var LAYOUT={
      wide:{z:11,p:[[-1,.95,0],[-.38,-1,.2],[.24,1.05,-.2],[1,-.55,0]]},
      tall:{z:13.4,p:[[-1,2.95,0],[1.05,1.15,.2],[-1.05,-.65,-.2],[1,-2.3,0]]}
    };
    function layout(m){
      mode=m;var L=LAYOUT[m],pts=[],at=[];
      // World width left of the panel at the stage's depth: stations spread to fit it.
      var vis=2*L.z*Math.tan(camera.fov*Math.PI/360)*(W/H),free=vis*(W-panelW)/W;
      scaleS=m==='wide'?Math.min(1,free/9.4):.72;
      var half=free/2-1.12*scaleS;
      stations.forEach(function(g,i){
        var x=m==='wide'?L.p[i][0]*half:L.p[i][0];
        at.push(new THREE.Vector3(x,L.p[i][1],L.p[i][2]));
        g.position.copy(at[i]);g.scale.setScalar(scaleS);
      });
      for(var i=0;i<4;i++){
        // Behind the object, so the lit wire is seen through the glass.
        var v=at[i].clone();v.z-=.5*scaleS;pts.push(v);
        if(i<3)pts.push(v.clone().lerp(at[i+1],.5).add(new THREE.Vector3(0,0,-.45)));
      }
      curve=new THREE.CatmullRomCurve3(pts,false,'centripetal');
      lengths=curve.getLengths(240);
      [[base,.038],[lit,.03],[ret,.031]].forEach(function(e){
        e[0].geometry.dispose();e[0].geometry=new THREE.TubeGeometry(curve,200,e[1],10,false);
      });
      camera.position.z=L.z;
    }
    function frac(t){return lengths[Math.round(t*240)]/lengths[240];}
    function smooth(a,b,x){var t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
    function band(a,b){return smooth(a-.2,a+.08,T)*(1-smooth(b-.08,b+.2,T));}

    function resize(){
      W=stage.clientWidth;H=stage.clientHeight;
      if(!W||!H)return;
      renderer.setSize(W,H,false);
      camera.aspect=W/H;
      var panel=root.querySelector('.sc-panel');
      panelW=getComputedStyle(panel).position==='absolute'?panel.offsetWidth:0;
      layout(W<640?'tall':'wide');
      if(panelW)camera.setViewOffset(W,H,-panelW/2,0,W,H);else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      wake();
    }

    var par={x:0,y:0},parT={x:0,y:0},v3=new THREE.Vector3();
    function draw(){
      camera.position.x=par.x*.4;camera.position.y=-par.y*.3;camera.lookAt(0,0,0);

      // Where the request is along the route (t), per step.
      var t,idx=Math.min(4,Math.floor(T)),p=T-idx,e=p*p*(3-2*p);
      if(idx===0)t=e/3;else if(idx===1)t=1/3+e/3;else if(idx===2)t=2/3+e/3;else if(idx===3)t=1;else t=1-e;
      var f=frac(t),back=T>=4,on=T>.02&&T<4.98&&(T<2.98||back);
      var count=lit.geometry.index.count,cut=Math.floor(count*f/6)*6;
      lit.geometry.setDrawRange(0,back?count:cut);
      ret.visible=back;ret.geometry.setDrawRange(cut,count-cut);

      var pos=curve.getPoint(t);
      head.visible=halo.visible=on;
      head.position.copy(pos);halo.position.copy(pos);
      var col=back?AMBER:ACCENT;haloM.color.copy(col);trailM.color.copy(col);
      trail.forEach(function(s,k){
        var tt=Math.max(0,Math.min(1,t+(back?1:-1)*(k+1)*.009));
        s.visible=on;s.position.copy(curve.getPoint(tt));
      });

      // Each station wakes up in its own step.
      var a0=Math.max(band(0,.7),smooth(4.7,4.95,T)),a1=Math.max(band(.7,1.3),band(4.4,4.7)),a2=band(1.7,2.3),a3=band(2.7,4.4);
      fil.emissiveIntensity=.2+a0*1.6;bulbHaloM.opacity=a0*.75;bulbHalo.visible=a0>.01;
      brainM.emissiveIntensity=.12+a1*.8;srvM.emissiveIntensity=.12+a2*.7;
      tools.forEach(function(o,i){
        var a=i/6*Math.PI*2+T*.9;
        o.position.set(Math.cos(a)*.92,Math.sin(a)*.92,0);o.rotation.z=a;
        o.scale.setScalar(i===0?1+a2*.55:1);
      });
      toolM.emissiveIntensity=.12+a2*.5;pick.emissiveIntensity=.2+a2;
      ringG.rotation.y=Math.sin(T*.8)*.3;
      tileM.emissiveIntensity=.12+a3*.22;wM.emissiveIntensity=.6+a3*.3;dotP.emissiveIntensity=.55+a3*.4;
      // A full turn during its own step, so it reads as an object, resting slightly angled.
      logo.rotation.y=.24+smooth(2,3,T)*Math.PI*2;logo.rotation.x=-.1;
      built.forEach(function(s){
        var k=smooth(s.a,s.b,T-3);
        s.o.visible=k>.001;
        s.o.scale.setScalar(.6+.4*k);
        s.o.position.z=s.z+(1-k)*.9;
      });
      bubble.rotation.y=.22+Math.sin(T*.6)*.06;
      [a0,a1,a2,a3].forEach(function(a,i){stations[i].scale.setScalar(scaleS*(1+a*.05));});

      // Labels sit just under each station.
      var drop=mode==='wide'?[1.36,1.32,1.46,1.56]:[1,.98,1.06,1.16];
      stations.forEach(function(g,i){
        v3.copy(g.position);v3.y-=drop[i]*(mode==='wide'?scaleS:1);v3.project(camera);
        var x=(v3.x+1)/2*W,y=(1-v3.y)/2*H;
        tags[i].style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px) translate(-50%,-50%)';
        tags[i].classList.toggle('on',[a0,a1,a2,a3][i]>.5);
      });

      var s=Math.max(0,Math.min(4,Math.ceil(T)-1));
      if(s!==curStep){
        curStep=s;
        items.forEach(function(li,i){
          li.classList.toggle('cur',i===s);
          var b=li.querySelector('.sc-step');
          if(i===s)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
        });
      }
      syncCtl();
      renderer.render(scene,camera);
      root.classList.add('ready');
    }
    function syncCtl(){
      if(reduced)return;
      var label=playing?root.dataset.pause:(T>=5?root.dataset.replay:root.dataset.resume);
      if(ctl.textContent!==label)ctl.textContent=label;
    }
    function frame(now){
      raf=0;
      var dt=Math.min((now-last)/1000,.05);last=now;
      if(playing&&T<hold){T=Math.min(hold,T+dt/STEP);if(T>=hold)playing=false;}
      par.x+=(parT.x-par.x)*.08;par.y+=(parT.y-par.y)*.08;
      var settling=Math.abs(parT.x-par.x)>.002||Math.abs(parT.y-par.y)>.002;
      draw();
      if((playing||settling)&&visible)raf=requestAnimationFrame(frame);
    }
    function wake(){if(!raf&&visible&&W){last=performance.now();raf=requestAnimationFrame(frame);}}

    items.forEach(function(li,i){
      li.querySelector('.sc-step').addEventListener('click',function(){
        touched=true;
        if(reduced){T=i+1;hold=T;playing=false;}else{T=i;hold=i+1;playing=true;}
        wake();
      });
    });
    if(!reduced){
      ctl.hidden=false;
      ctl.addEventListener('click',function(){
        touched=true;
        if(playing)playing=false;
        else{if(T>=5)T=0;hold=5;playing=true;}
        syncCtl();wake();
      });
      stage.addEventListener('pointermove',function(e){
        if(e.pointerType==='touch')return;
        var r=stage.getBoundingClientRect();
        parT.x=(e.clientX-r.left)/r.width-.5;parT.y=(e.clientY-r.top)/r.height-.5;wake();
      },{passive:true});
      stage.addEventListener('pointerleave',function(){parT.x=parT.y=0;wake();});
    }

    function paintTheme(){
      var dark=html.getAttribute('data-theme')==='dark'||(!html.getAttribute('data-theme')&&mq('(prefers-color-scheme: dark)'));
      wireBase.color.set(dark?0x9fc4b2:0x4f7263);wireBase.opacity=dark?.3:.42;
      scene.environmentIntensity=dark?.85:1.05;
      wake();
    }
    new MutationObserver(paintTheme).observe(html,{attributes:true,attributeFilter:['data-theme']});
    if(window.matchMedia)matchMedia('(prefers-color-scheme: dark)').addEventListener('change',paintTheme);

    new IntersectionObserver(function(es){visible=es[0].isIntersecting;if(visible)wake();},{threshold:0}).observe(stage);
    // Plays through once, the first time most of it is on screen; then it rests.
    var starter=new IntersectionObserver(function(es){
      if(!es[0].isIntersecting)return;
      starter.disconnect();
      if(!touched&&!reduced){playing=true;wake();}
    },{threshold:.45});
    starter.observe(stage);

    if(window.ResizeObserver)new ResizeObserver(resize).observe(stage);else window.addEventListener('resize',resize);
    resize();paintTheme();
    visible=true;wake();
  }
})();
`;
