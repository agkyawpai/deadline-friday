// Low-poly isometric office built from primitives only (no model files => tiny download).
import * as THREE from 'three';
import { ROLE_ICON } from './i18n.js';

const ISO = new THREE.Vector3(1, 1.25, 1).normalize();
const matCache = new Map();
function mat(color, basic = false) {
  const key = color + basic;
  if (!matCache.has(key)) {
    matCache.set(key, basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
  }
  return matCache.get(key);
}
function box(parent, w, h, d, color, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.canvas = c;
  return tex;
}

export class Office {
  constructor(container, world) {
    this.world = world;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);
    this.labels = [];

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2b2d42');
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camTarget = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.follow = 0.12;
    this.shakeAmt = 0;
    this.time = 0;
    this.chars = new Map();
    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.stationById = Object.fromEntries(world.stations.map((s) => [s.id, s]));

    this.buildLights();
    this.buildRoom();
    this.buildStations();
    this.buildEffects();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---------- Build ----------
  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8d99ae', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(8, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
    this.scene.add(sun);
  }

  buildRoom() {
    const s = this.scene;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), mat('#e8e1d3'));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    this.floor = floor;
    const rug = (w, d, x, z, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.01, z);
      m.receiveShadow = true;
      s.add(m);
    };
    rug(10, 8.6, -5, -0.5, '#a5b8cc');
    rug(6, 5, 6.5, -1.5, '#e6cfae');
    rug(1.8, 2.4, -10.9, 6, '#7bd389');

    box(s, 24.6, 3.2, 0.3, '#f7f3ea', 0, 1.6, -8.15);
    box(s, 0.3, 3.2, 16.3, '#efe9dc', -12.15, 1.6, 0);
    box(s, 24.6, 0.2, 0.34, '#b8a88a', 0, 0.1, -8.1, false);
    box(s, 0.34, 0.2, 16.3, '#b8a88a', -12.1, 0.1, 0, false);

    for (const x of [-8, -4.5, 7]) {
      box(s, 2.6, 1.3, 0.06, '#9ad1f5', x, 2, -7.98, false);
      box(s, 2.6, 0.08, 0.1, '#ffffff', x, 2, -7.95, false);
    }
    // Door + exit sign on the left wall
    box(s, 0.1, 2.2, 1.4, '#8d5a3b', -11.97, 1.1, 6, false);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.9), mat('#2ecc71', true));
    sign.position.set(-11.95, 2.6, 6);
    s.add(sign);

    // Funny posters
    const poster = (lines, bg, x, z, rotY) => {
      const tex = canvasTexture(256, 320, (ctx, w, h) => {
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = 'bold 30px sans-serif';
        lines.forEach((l, i) => ctx.fillText(l, w / 2, 80 + i * 44));
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(x, 1.9, z);
      m.rotation.y = rotY;
      s.add(m);
    };
    poster(['MOVE', 'FAST', '&', 'BREAK', 'PROD'], '#e74c3c', -11.98, -3.5, Math.PI / 2);
    poster(['IT\'S NOT', 'A BUG', 'IT\'S A', 'FEATURE'], '#6c5ce7', -11.98, 1.5, Math.PI / 2);
    poster(['NEVER', 'DEPLOY', 'ON', 'FRIDAY'], '#00b894', 5.2, -7.98, 0);

    // Wall clock driven by in-game time
    const clock = new THREE.Group();
    clock.position.set(0, 2.3, -7.95);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 24), mat('#ffffff'));
    face.rotation.x = Math.PI / 2;
    clock.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 24), mat('#2d3436'));
    clock.add(rim);
    const hand = (len, wid, color) => {
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(wid, len, 0.02), mat(color));
      m.position.set(0, len / 2, 0.05);
      pivot.add(m);
      clock.add(pivot);
      return pivot;
    };
    this.hourHand = hand(0.28, 0.06, '#2d3436');
    this.minHand = hand(0.42, 0.04, '#e74c3c');
    s.add(clock);

    // Plants
    for (const [x, z] of [[11, 7], [11.1, -3.6], [-11.2, 3.3], [-0.2, 7]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.5, 8), mat('#d35400'));
      pot.position.set(x, 0.25, z);
      pot.castShadow = true;
      s.add(pot);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mat('#27ae60'));
      leaves.position.set(x, 0.95, z);
      leaves.castShadow = true;
      s.add(leaves);
    }
  }

  buildStations() {
    this.codeTex = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, w, h);
      const colors = ['#89b4fa', '#a6e3a1', '#f38ba8', '#f9e2af', '#cba6f7', '#94e2d5'];
      for (let y = 6; y < h; y += 10) {
        let x = 6 + Math.floor(Math.random() * 3) * 10;
        while (x < w - 10 && Math.random() > 0.15) {
          const len = 8 + Math.random() * 30;
          ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
          ctx.fillRect(x, y, len, 5);
          x += len + 5;
        }
      }
    });
    this.codeTex.wrapT = THREE.RepeatWrapping;
    this.codeTex.repeat.set(1, 0.5);
    this.stationLabels = {};

    for (const st of this.world.stations) {
      const g = new THREE.Group();
      g.position.set(st.x, 0, st.z);
      this.scene.add(g);
      switch (st.type) {
        case 'desk': this.buildDesk(g, true); break;
        case 'phone': this.buildPhoneDesk(g); break;
        case 'coffee': this.buildCoffee(g); break;
        case 'server': this.buildServer(g); break;
        case 'board': this.buildSprintBoard(g); break;
        case 'qa': this.buildQaLab(g); break;
        case 'meeting': this.buildMeeting(g); break;
        default: break;
      }
    }
    const lbl = (id, text, y) => {
      const st = this.stationById[id];
      this.stationLabels[id] = this.addLabel(`<div class="station-tag">${text}</div>`, () => new THREE.Vector3(st.x, y, st.z));
    };
    lbl('coffee', '☕', 2.3);
    lbl('server', '🖥️', 2.9);
    lbl('phone', '📞 Sales', 1.7);
    lbl('qa', '🔍 QA', 1.9);
    lbl('board', '📋 Sprint', 2.8);
    lbl('exit', '🚪 EXIT', 2.4);
    lbl('meeting', '🍕', 1.6);
    this.stationLabels.meeting.el.classList.add('hidden');
  }

  buildQaLab(g) {
    box(g, 1.6, 0.08, 1.0, '#dfe6e9', 0, 0.76, 0);
    for (const [x, z] of [[-0.72, -0.42], [0.72, -0.42], [-0.72, 0.42], [0.72, 0.42]]) box(g, 0.07, 0.76, 0.07, '#636e72', x, 0.38, z);
    // a row of test phones and a tablet
    for (let i = 0; i < 3; i++) {
      box(g, 0.16, 0.3, 0.03, '#2d3436', -0.5 + i * 0.25, 0.95, -0.2, false);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.25), new THREE.MeshBasicMaterial({ color: ['#55efc4', '#74b9ff', '#ffeaa7'][i] }));
      scr.position.set(-0.5 + i * 0.25, 0.95, -0.18);
      g.add(scr);
    }
    box(g, 0.5, 0.03, 0.36, '#2d3436', 0.45, 0.8, 0.15, false);
    const net = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 6, 16), mat('#00b894'));
    net.position.set(0.55, 1.15, -0.15);
    g.add(net);
    box(g, 0.03, 0.5, 0.03, '#8d6e63', 0.55, 0.85, -0.15, false);
  }

  buildDesk(g, withChair) {
    box(g, 1.8, 0.08, 0.9, '#c8a27a', 0, 0.76, 0);
    for (const [x, z] of [[-0.82, -0.38], [0.82, -0.38], [-0.82, 0.38], [0.82, 0.38]]) box(g, 0.07, 0.76, 0.07, '#6d4c41', x, 0.38, z);
    box(g, 0.08, 0.3, 0.08, '#333', 0, 0.95, -0.2);
    box(g, 0.92, 0.58, 0.06, '#222', 0, 1.3, -0.24);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.48), new THREE.MeshBasicMaterial({ map: this.codeTex }));
    screen.position.set(0, 1.3, -0.205);
    g.add(screen);
    box(g, 0.6, 0.03, 0.18, '#444', 0, 0.815, 0.12);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 8), mat(['#e17055', '#0984e3', '#fdcb6e', '#ffffff'][Math.floor(Math.random() * 4)]));
    mug.position.set(0.6, 0.86, 0.1);
    g.add(mug);
    if (withChair) {
      box(g, 0.55, 0.08, 0.55, '#34495e', 0, 0.48, 0.8);
      box(g, 0.55, 0.45, 0.08, '#34495e', 0, 0.74, 1.06);
      box(g, 0.06, 0.44, 0.06, '#222', 0, 0.22, 0.8, false);
    }
  }

  buildPhoneDesk(g) {
    this.buildDesk(g, false);
    const phone = new THREE.Group();
    phone.position.set(-0.55, 0.8, 0.1);
    box(phone, 0.32, 0.1, 0.24, '#c0392b', 0, 0.05, 0);
    this.handset = box(phone, 0.36, 0.07, 0.09, '#922b21', 0, 0.14, 0);
    g.add(phone);
    this.phoneGroup = phone;
  }

  buildCoffee(g) {
    box(g, 1.3, 0.9, 0.9, '#8d6e63', 0, 0.45, 0);
    box(g, 0.62, 0.78, 0.5, '#2d3436', 0, 1.29, -0.05);
    box(g, 0.12, 0.08, 0.12, '#636e72', 0, 1.0, 0.18);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 8), mat('#ffffff'));
    cup.position.set(0, 0.96, 0.18);
    g.add(cup);
    this.coffeeLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#2ecc71' }));
    this.coffeeLight.position.set(0.2, 1.5, 0.21);
    g.add(this.coffeeLight);
    this.puffs = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }));
      p.position.set(0, 1.8, 0);
      p.userData.phase = i / 4;
      g.add(p);
      this.puffs.push(p);
    }
  }

  buildServer(g) {
    box(g, 1.25, 2.3, 1.05, '#1e272e', 0, 1.15, 0);
    this.leds = [];
    for (let r = 0; r < 7; r++) {
      box(g, 1.05, 0.02, 0.02, '#485460', 0, 0.35 + r * 0.28, 0.53, false);
      for (let c = 0; c < 4; c++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: '#2ecc71' }));
        led.position.set(-0.4 + c * 0.12, 0.45 + r * 0.28, 0.54);
        g.add(led);
        this.leds.push(led);
      }
    }
    this.serverGroup = g;
  }

  buildSprintBoard(g) {
    box(g, 2.7, 1.6, 0.06, '#8d6e63', 0, 1.75, 0.15, false);
    this.boardTex = canvasTexture(576, 320, () => {});
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.4), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.position.set(0, 1.75, 0.19);
    g.add(board);
    this.setBoard([]);
  }

  buildMeeting(g) {
    box(g, 3.2, 0.1, 1.6, '#f1e6d2', 0, 0.75, 0);
    box(g, 0.2, 0.7, 0.2, '#6d4c41', -1, 0.35, 0);
    box(g, 0.2, 0.7, 0.2, '#6d4c41', 1, 0.35, 0);
    for (const x of [-1.1, 0, 1.1]) {
      for (const side of [-1, 1]) {
        box(g, 0.5, 0.08, 0.5, '#e67e22', x, 0.45, side * 1.25);
        box(g, 0.5, 0.4, 0.08, '#e67e22', x, 0.68, side * 1.48);
      }
    }
    const pizza = new THREE.Group();
    box(pizza, 0.8, 0.06, 0.8, '#c8a27a', 0, 0.03, 0);
    const pie = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 12), mat('#f6b93b'));
    pie.position.y = 0.08;
    pizza.add(pie);
    for (let i = 0; i < 6; i++) {
      const pep = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 8), mat('#c0392b'));
      pep.position.set(Math.cos(i) * 0.2, 0.11, Math.sin(i * 1.7) * 0.2);
      pizza.add(pep);
    }
    pizza.position.y = 0.8;
    pizza.visible = false;
    g.add(pizza);
    this.pizza = pizza;
  }

  buildEffects() {
    // Server fire
    const st = this.stationById.server;
    this.fire = new THREE.Group();
    this.fire.position.set(st.x, 0, st.z);
    this.flames = [];
    for (let i = 0; i < 12; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? '#ffd32a' : '#ff5e13', transparent: true, opacity: 0.9 }));
      const a = Math.random() * Math.PI * 2;
      f.position.set(Math.cos(a) * 0.5, 2.4, Math.sin(a) * 0.45 + 0.2);
      f.userData.base = f.position.clone();
      f.userData.k = 6 + Math.random() * 6;
      this.fire.add(f);
      this.flames.push(f);
    }
    this.fireLight = new THREE.PointLight('#ff6a00', 0, 9);
    this.fireLight.position.set(0, 2.5, 1);
    this.fire.add(this.fireLight);
    this.fire.visible = false;
    this.scene.add(this.fire);

    // Highlight ring under the nearest interactable station
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32),
      new THREE.MeshBasicMaterial({ color: '#ffd43b', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    this.scene.add(this.ring);

    // CEO NPC
    this.ceo = this.makeCharacter('#f1c40f', 'ceo');
    this.ceo.group.scale.setScalar(1.25);
    this.ceo.group.visible = false;
    this.scene.add(this.ceo.group);
    this.ceoLabel = this.addLabel('<div class="nametag ceo">👴 CEO</div>', () => this.ceo.group.position.clone().setY(2.6));
    this.ceoLabel.el.classList.add('hidden');
    this.ceoPath = [[-11.3, 6], [-6.5, 4], [-3.5, 0], [-6.5, -0.4], [-9.8, -0.4], [-6.5, 4], [-11.3, 6]].map(([x, z]) => new THREE.Vector2(x, z));
  }

  // ---------- Characters ----------
  makeCharacter(color, role) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 4, 10), mat(color));
    body.position.y = 0.62;
    body.castShadow = true;
    inner.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), mat('#f1c9a5'));
    head.position.y = 1.28;
    head.castShadow = true;
    inner.add(head);
    for (const x of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mat('#2d3436'));
      eye.position.set(x, 1.32, 0.24);
      inner.add(eye);
    }
    const ch = { group, inner, body, head, acc: null, role: null, x: 0, z: 0, tx: 0, tz: 0, face: 0, moving: false, frozen: null, prop: null, walkT: Math.random() * 10 };
    this.setAccessory(ch, role);
    return ch;
  }

  setAccessory(ch, role) {
    if (ch.role === role) return;
    if (ch.acc) ch.inner.remove(ch.acc);
    ch.role = role;
    ch.prop = null;
    const a = new THREE.Group();
    const tie = (color) => box(a, 0.09, 0.32, 0.03, color, 0, 0.8, 0.3, false);
    switch (role) {
      case 'manager': {
        tie('#c0392b');
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), mat('#2d3436'));
        hair.position.y = 1.3;
        a.add(hair);
        break;
      }
      case 'leader': {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.03, 6, 16, Math.PI), mat('#2d3436'));
        band.position.y = 1.3;
        a.add(band);
        box(a, 0.08, 0.12, 0.12, '#2d3436', 0.29, 1.28, 0, false);
        box(a, 0.03, 0.03, 0.22, '#2d3436', 0.24, 1.18, 0.14, false);
        break;
      }
      case 'senior': {
        const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 10), mat('#6c5ce7'));
        hat.position.y = 1.72;
        hat.rotation.z = 0.15;
        a.add(hat);
        const beard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 8), mat('#dfe6e9'));
        beard.position.set(0, 1.05, 0.2);
        beard.rotation.x = Math.PI;
        a.add(beard);
        break;
      }
      case 'junior': {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), mat('#fdcb6e'));
        cap.position.y = 1.32;
        a.add(cap);
        box(a, 0.02, 0.12, 0.02, '#2d3436', 0, 1.64, 0, false);
        const prop = new THREE.Group();
        prop.position.y = 1.71;
        box(prop, 0.5, 0.02, 0.07, '#e84393', 0, 0, 0, false);
        a.add(prop);
        ch.prop = prop;
        break;
      }
      case 'qa': {
        for (const x of [-0.1, 0.1]) {
          const lens = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12), mat('#2d3436'));
          lens.position.set(x, 1.32, 0.27);
          a.add(lens);
        }
        const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 14, 1, true), mat('#00b894'));
        visor.position.y = 1.45;
        a.add(visor);
        break;
      }
      case 'sales': {
        tie('#f1c40f');
        box(a, 0.36, 0.07, 0.04, '#111', 0, 1.33, 0.26, false);
        break;
      }
      case 'ceo': {
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 8, 1, true), mat('#f39c12'));
        crown.position.y = 1.55;
        a.add(crown);
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), mat('#f39c12'));
          const ang = (i / 5) * Math.PI * 2;
          spike.position.set(Math.cos(ang) * 0.2, 1.68, Math.sin(ang) * 0.2);
          a.add(spike);
        }
        box(a, 0.26, 0.05, 0.04, '#5d4037', 0, 1.22, 0.26, false);
        break;
      }
      default: break;
    }
    ch.acc = a;
    ch.inner.add(a);
  }

  syncPlayers(list, myId, myPos) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let ch = this.chars.get(p.id);
      if (!ch) {
        ch = this.makeCharacter(p.color, p.role);
        ch.x = ch.tx = p.x;
        ch.z = ch.tz = p.z;
        this.scene.add(ch.group);
        ch.label = this.addLabel('<div class="nametag"></div><div class="status"></div><div class="bubble hidden"></div>', () => ch.group.position.clone().setY(2.1));
        ch.label.el.classList.add('char-label');
        this.chars.set(p.id, ch);
      }
      this.setAccessory(ch, p.role);
      const isMe = p.id === myId;
      if (isMe && myPos) {
        ch.tx = myPos.x; ch.tz = myPos.z; ch.face = myPos.face; ch.moving = myPos.moving;
        ch.x = myPos.x; ch.z = myPos.z;
      } else {
        ch.tx = p.x; ch.tz = p.z; ch.face = p.face; ch.moving = p.moving;
      }
      ch.frozen = p.frozen;
      const tag = `<span class="ico">${p.role ? ROLE_ICON[p.role] : '🙂'}</span>${escapeHtml(p.name)}`;
      const nameEl = ch.label.el.firstChild;
      if (nameEl.dataset.k !== tag + isMe) {
        nameEl.innerHTML = tag;
        nameEl.dataset.k = tag + isMe;
        nameEl.style.borderColor = p.color;
        nameEl.classList.toggle('me', isMe);
      }
      const statusEl = ch.label.el.children[1];
      const status = p.frozen === 'burnout' ? '💀💤' : p.frozen === 'locked' ? '🪟⏳' : p.frozen === 'meeting' ? '📢' : '';
      if (statusEl.textContent !== status) statusEl.textContent = status;
    }
    for (const [id, ch] of this.chars) {
      if (!seen.has(id)) {
        this.scene.remove(ch.group);
        this.removeLabel(ch.label);
        this.chars.delete(id);
      }
    }
  }

  showEmote(id, text) {
    const ch = this.chars.get(id);
    if (!ch) return;
    const b = ch.label.el.children[2];
    b.textContent = text;
    b.classList.remove('hidden');
    if (window.gsap) window.gsap.fromTo(b, { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.add('hidden'), 3200);
  }

  // ---------- Dynamic props ----------
  setFire(on) { this.fire.visible = !!on; }
  setPhone(on) { this.phoneRinging = !!on; this.stationLabels.phone.el.classList.toggle('ringing', !!on); }
  setPizza(on) { this.pizza.visible = !!on; this.stationLabels.meeting.el.classList.toggle('hidden', !on); }
  setCoffeeBroken(on) {
    this.coffeeBroken = !!on;
    this.coffeeLight.material.color.set(on ? '#e74c3c' : '#2ecc71');
    for (const p of this.puffs) p.material.color.set(on ? '#555555' : '#ffffff');
  }
  setClock(hours) {
    this.minHand.rotation.z = -((hours % 1) * Math.PI * 2);
    this.hourHand.rotation.z = -(((hours % 12) / 12) * Math.PI * 2);
  }
  // Kanban on the wall: one sticky note per ticket in its stage column.
  setBoard(tickets) {
    const key = tickets.map((tk) => tk.id + tk.stage).join(',');
    if (this.boardKey === key) return;
    this.boardKey = key;
    const c = this.boardTex.userData.canvas;
    const ctx = c.getContext('2d');
    const cols = ['TODO', 'DEV', 'REVIEW', 'QA', 'DEMO', 'DONE'];
    const stages = ['todo', 'dev', 'review', 'qa', 'demo', 'done'];
    const colW = c.width / cols.length;
    ctx.fillStyle = '#fdfdfd'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    cols.forEach((name, i) => {
      ctx.fillStyle = i % 2 ? '#f1f2f6' : '#fdfdfd';
      ctx.fillRect(i * colW, 0, colW, c.height);
      ctx.fillStyle = '#2d3436';
      ctx.fillText(name, i * colW + colW / 2, 28);
      const notes = tickets.filter((tk) => tk.stage === stages[i]);
      notes.slice(0, 6).forEach((tk, j) => {
        ctx.fillStyle = ['#ffeaa7', '#fab1a0', '#81ecec', '#a29bfe', '#55efc4', '#fd79a8'][tk.id % 6];
        ctx.fillRect(i * colW + 10, 44 + j * 44, colW - 20, 38);
        ctx.fillStyle = '#2d3436';
        ctx.fillText(`#${tk.id} ${tk.key}`.slice(0, 10), i * colW + colW / 2, 70 + j * 44);
      });
    });
    this.boardTex.needsUpdate = true;
  }

  setDeploy(d) {
    const ids = ['server', 'board', 'qa', 'phone'];
    if (!this.deployRings) {
      this.deployRings = ids.map((id) => {
        const st = this.stationById[id];
        const r = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 32), new THREE.MeshBasicMaterial({ color: '#ff922b', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        r.rotation.x = -Math.PI / 2;
        r.position.set(st.x, 0.04, st.z + (id === 'board' ? 1.2 : 0));
        r.visible = false;
        this.scene.add(r);
        return r;
      });
    }
    this.deployRings.forEach((r, i) => {
      r.visible = !!d;
      if (d) r.material.color.set(d.occupied.includes(ids[i]) ? '#51cf66' : '#ff922b');
    });
  }
  setCEO(leftMs, totalMs = 12000) {
    const on = leftMs > 0;
    this.ceo.group.visible = on;
    this.ceoLabel.el.classList.toggle('hidden', !on);
    if (!on) return;
    const u = 1 - leftMs / totalMs;
    const segs = [];
    let total = 0;
    for (let i = 0; i < this.ceoPath.length - 1; i++) { const l = this.ceoPath[i].distanceTo(this.ceoPath[i + 1]); segs.push(l); total += l; }
    let d = u * total;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) {
        const a = this.ceoPath[i], b = this.ceoPath[i + 1];
        const k = Math.min(1, d / segs[i]);
        this.ceo.tx = a.x + (b.x - a.x) * k;
        this.ceo.tz = a.y + (b.y - a.y) * k;
        this.ceo.face = Math.atan2(b.x - a.x, b.y - a.y);
        break;
      }
      d -= segs[i];
    }
    this.ceo.moving = true;
    if (!this.ceo.placed) { this.ceo.x = this.ceo.tx; this.ceo.z = this.ceo.tz; this.ceo.placed = true; }
  }
  setHighlight(st) {
    this.ring.visible = !!st;
    if (!st) return;
    this.ring.position.set(st.x, 0.03, st.z);
    this.ring.scale.setScalar(Math.max(st.w, st.d) * 0.55 + 0.5);
  }
  setFocus(x, z, follow) { this.focus.set(x, 0, z); if (follow !== undefined) this.follow = follow; }
  shake(amount = 0.4) { this.shakeAmt = Math.max(this.shakeAmt, amount); }

  // ---------- Labels (HTML projected onto 3D positions) ----------
  addLabel(html, getPos) {
    const el = document.createElement('div');
    el.className = 'label3d';
    el.innerHTML = html;
    this.labelLayer.appendChild(el);
    const label = { el, getPos };
    this.labels.push(label);
    return label;
  }
  removeLabel(label) {
    label.el.remove();
    this.labels = this.labels.filter((l) => l !== label);
  }

  // ---------- Input ----------
  pickFloor(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, hit) ? hit : null;
  }

  // ---------- Loop ----------
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const aspect = w / h;
    this.portrait = aspect < 1;
    const halfH = this.portrait ? 7.5 / aspect : Math.max(10.2, 14.6 / aspect);
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.w = w; this.h = h;
  }

  animateChar(ch, dt, t) {
    const k = Math.min(1, dt * 8); // remote positions arrive ~5x/s; smooth between them
    ch.x += (ch.tx - ch.x) * k;
    ch.z += (ch.tz - ch.z) * k;
    ch.group.position.set(ch.x, 0, ch.z);
    let dr = ch.face - ch.group.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    ch.group.rotation.y += dr * Math.min(1, dt * 10);
    const inner = ch.inner;
    if (ch.frozen === 'burnout') {
      inner.rotation.x += (-1.3 - inner.rotation.x) * k;
      inner.position.y = 0.3;
      inner.rotation.z = 0;
    } else if (ch.frozen === 'locked') {
      inner.rotation.x = 0;
      inner.position.y = 0;
      inner.rotation.z = Math.sin(t * 30) * 0.05;
    } else if (ch.moving) {
      ch.walkT += dt * 12;
      inner.rotation.x = 0;
      inner.position.y = Math.abs(Math.sin(ch.walkT)) * 0.12;
      inner.rotation.z = Math.sin(ch.walkT) * 0.08;
    } else {
      inner.rotation.x += (0 - inner.rotation.x) * k;
      inner.position.y = Math.sin(t * 2 + ch.walkT) * 0.02;
      inner.rotation.z *= 0.9;
    }
    if (ch.prop) ch.prop.rotation.y += dt * (ch.moving ? 25 : 6);
  }

  frame(dt) {
    this.time += dt;
    const t = this.time;
    for (const ch of this.chars.values()) this.animateChar(ch, dt, t);
    if (this.ceo.group.visible) this.animateChar(this.ceo, dt, t);
    else this.ceo.placed = false;

    this.codeTex.offset.y = (this.codeTex.offset.y + dt * 0.04) % 1;
    if (this.leds) {
      for (let i = 0; i < this.leds.length; i++) {
        const on = Math.sin(t * (3 + (i % 5)) + i * 1.7) > -0.2;
        this.leds[i].material.color.set(this.fire.visible ? (on ? '#ff3f34' : '#3d0000') : (on ? '#0be881' : '#05391e'));
      }
    }
    if (this.fire.visible) {
      for (const f of this.flames) {
        const s = 0.6 + Math.abs(Math.sin(t * f.userData.k + f.userData.base.x * 10)) * 0.8;
        f.scale.set(1, s, 1);
        f.position.y = f.userData.base.y + (s - 1) * 0.3;
      }
      this.fireLight.intensity = 6 + Math.sin(t * 20) * 2;
      this.serverGroup.position.x = this.stationById.server.x + Math.sin(t * 40) * 0.02;
    }
    if (this.phoneGroup) {
      const ring = this.phoneRinging && Math.sin(t * 6) > 0;
      this.handset.position.y = ring ? 0.18 + Math.abs(Math.sin(t * 40)) * 0.06 : 0.14;
      this.phoneGroup.rotation.y = ring ? Math.sin(t * 50) * 0.15 : 0;
    }
    for (const p of this.puffs) {
      const u = (t * (this.coffeeBroken ? 0.8 : 0.35) + p.userData.phase) % 1;
      p.position.set(Math.sin(u * 6 + p.userData.phase * 9) * 0.15, 1.75 + u * 1.1, 0);
      p.scale.setScalar(this.coffeeBroken ? 1 + u * 2 : 0.4 + u);
      p.material.opacity = (1 - u) * (this.coffeeBroken ? 0.8 : 0.35);
    }
    if (this.pizza.visible) this.pizza.rotation.y += dt * 0.8;
    if (this.ring.visible) this.ring.material.opacity = 0.5 + Math.sin(t * 6) * 0.3;
    if (this.deployRings?.[0].visible) for (const r of this.deployRings) r.scale.setScalar(1 + Math.sin(t * 5) * 0.06);

    // Camera follow + shake
    // Landscape: nudge the view down a bit so the top HUD doesn't cover the back wall.
    const base = this.portrait ? new THREE.Vector3() : new THREE.Vector3(-1.3, 0, -1.3);
    this.camTarget.lerp(this.focus.clone().multiplyScalar(this.follow).add(base), Math.min(1, dt * 4));
    const shake = new THREE.Vector3();
    if (this.shakeAmt > 0.001) {
      shake.set((Math.random() - 0.5) * this.shakeAmt, 0, (Math.random() - 0.5) * this.shakeAmt);
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    const target = this.camTarget.clone().add(shake);
    this.camera.position.copy(target).addScaledVector(ISO, 50);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);

    const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (l.el.classList.contains('hidden')) continue;
      v.copy(l.getPos()).project(this.camera);
      l.el.style.transform = `translate(${((v.x + 1) / 2) * this.w}px, ${((1 - v.y) / 2) * this.h}px) translate(-50%, -100%)`;
    }
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
