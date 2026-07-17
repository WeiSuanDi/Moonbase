import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getPlannedSites, getSiteDecisions, getCompletedSteps, computeNetworkMetrics } from './state.js';

export const bases = [
  {
    id: 'shackleton',
    name: '沙克尔顿基地',
    subtitle: '极地科研前哨',
    desc: '位于月球南极沙克尔顿陨石坑边缘，坑缘几乎全年有光照，坑底永久阴影区富含水冰。光照与水冰的“黄金组合”，但极端低温与险峻地形代价高昂。',
    lat: -89.67,
    lon: 129.78,
    altitude: '+4,200 m',
    type: '永久驻留站',
    selectable: true,
    tone: 0x00d4ff,
    illumination: 86,
    iceWt: 2.0,
    slope: 15
  },
  {
    id: 'connecting_ridge',
    name: '连接岭 C1-0',
    subtitle: '南极综合最优选址',
    desc: '连接 Shackleton 与 de Gerlache 的山脊。平均光照率 88%，最长连续阴影仅 112 小时，且距离最近 PSR 仅 100 米。太阳能与水冰提取可步行共存。',
    lat: -88.5,
    lon: 0,
    altitude: '+3,800 m',
    type: '综合最优站',
    selectable: true,
    tone: 0x00ffaa,
    illumination: 88,
    iceWt: 1.5,
    slope: 7
  },
  {
    id: 'cabeus',
    name: '卡比厄斯基地',
    subtitle: '富冰永久阴影区',
    desc: 'LCROSS 撞击实验直接测得羽流含水量 5.6±2.9 wt%，总水冰储量约 1.63 亿吨，是月球水冰原位确认置信度最高的地点。但位于永久阴影区内，无日照。',
    lat: -85.3,
    lon: -41.8,
    altitude: '-4,000 m',
    type: '资源开采站',
    selectable: true,
    tone: 0x44aaff,
    illumination: 0,
    iceWt: 5.6,
    slope: 5
  },
  {
    id: 'marius_lava_tube',
    name: '马里乌斯熔岩管',
    subtitle: '天然地下庇护所',
    desc: '天窗直径约 58 米，GRAIL 估计下方存在长 60 公里、宽 9 公里的空腔。天然辐射屏蔽与热稳定性使其成为改变游戏规则的选址，但水冰稀缺。',
    lat: 14.3,
    lon: -56.5,
    altitude: '-300 m',
    type: '地下栖息地',
    selectable: true,
    tone: 0xff66cc,
    illumination: 50,
    iceWt: 0.1,
    slope: 3
  },
  {
    id: 'tranquility',
    name: '静海纪念站',
    subtitle: '历史与旅游中心',
    desc: '坐落在阿波罗 11 号首次登月点附近，静海纪念站不仅是人类首次踏上另一颗星球的纪念地，更是未来月球旅游、科普教育与低重力体验的核心枢纽。',
    lat: 0.7,
    lon: 23.5,
    altitude: '-1,800 m',
    type: '文化旅游港',
    selectable: true,
    tone: 0xe0e0e0,
    illumination: 50,
    iceWt: 0,
    slope: 2
  },
  {
    id: 'imbrium',
    name: '雨海采矿区',
    subtitle: '资源工业基地',
    desc: '雨海盆地的玄武岩富含钛铁矿与氦-3 资源。这里部署了自动化采矿与冶炼设施，是月球工业化的起点，为地球与深空任务提供关键原材料。',
    lat: 32.8,
    lon: -15.6,
    altitude: '-2,500 m',
    type: '工业采矿区',
    selectable: true,
    tone: 0xffaa55,
    illumination: 50,
    iceWt: 0.2,
    slope: 4
  },
  {
    id: 'tycho',
    name: '第谷观测台',
    subtitle: '深空观测平台',
    desc: '位于壮观的第谷环形山区域，这里地质年轻、地貌崎岖，是天文观测与行星科学研究的理想场所。观测台配备射电与光学复合望远镜阵列。',
    lat: -43.3,
    lon: -11.2,
    altitude: '+2,000 m',
    type: '科研观测站',
    selectable: true,
    tone: 0xc9a0ff,
    illumination: 50,
    iceWt: 0.1,
    slope: 12
  }
];

let scene, camera, renderer, controls, composer, moon, markerGroup, glow, stars, earth;
let selectedMarker = null;
let overlayGroup = null;
let latestState = null;       // 最近一次 updateDecisionOverlays 收到的 state 快照（HUD 悬停卡使用）
const flowArcs = [];          // 补给弧线流光：{ curve, points, count, speed, offset }
const markers = [];
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let animFrameId = null;

// —— 交互增强状态（相机俯冲 / 悬停 HUD / 待机视差）——
let flyAnim = null;          // 进行中的相机俯冲动画
let hoverBaseId = null;      // 当前悬停的基地 id
let markerPulse = null;      // 标记点亮脉冲 { baseId, start }
const parallaxTarget = new THREE.Vector2(0, 0);
const parallaxCurrent = new THREE.Vector2(0, 0);
let controlsDragging = false;
const _parallaxRight = new THREE.Vector3();
const _parallaxUp = new THREE.Vector3();
const _parallaxOffset = new THREE.Vector3();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// 取消进行中的俯冲（不触发 onArrive）
function cancelFly() {
  if (flyAnim) {
    if (flyAnim.rafId) cancelAnimationFrame(flyAnim.rafId);
    flyAnim = null;
    if (controls) controls.enabled = true;
  }
}

/**
 * 相机俯冲选址：平滑补间到指定基地标记的近月面位置。
 * @param {string} siteId bases 数组中的基地 id
 * @param {{ duration?: number, onArrive?: () => void }} [options]
 * @returns {boolean} 是否成功启动俯冲
 */
export function flyToSite(siteId, { duration = 1100, onArrive } = {}) {
  if (!camera || !controls) return false;
  const base = bases.find(b => b.id === siteId);
  if (!base) return false;

  // 可重复调用：先取消上一段俯冲
  cancelFly();

  controls.autoRotate = false;
  controls.enabled = false;
  // 终点距离月面约 0.6 半径单位，低于默认 minDistance，需先放宽避免阻尼回弹
  controls.minDistance = Math.min(controls.minDistance, 0.35);

  const markerPos = latLonToVector3(base.lat, base.lon, 1.03);
  const normal = markerPos.clone().normalize();
  const endPos = markerPos.clone().add(normal.multiplyScalar(0.6));

  flyAnim = {
    rafId: null,
    start: performance.now(),
    duration,
    fromPos: camera.position.clone(),
    toPos: endPos,
    fromTarget: controls.target.clone(),
    toTarget: markerPos.clone(),
    onArrive: typeof onArrive === 'function' ? onArrive : null
  };

  // 标记光环比点亮脉冲
  markerPulse = { baseId: siteId, start: performance.now() };

  const step = (now) => {
    if (!flyAnim || !camera || !controls) return;
    const t = Math.min(1, (now - flyAnim.start) / flyAnim.duration);
    const k = easeInOutCubic(t);
    camera.position.lerpVectors(flyAnim.fromPos, flyAnim.toPos, k);
    controls.target.lerpVectors(flyAnim.fromTarget, flyAnim.toTarget, k);
    camera.lookAt(controls.target);
    if (t >= 1) {
      const arrive = flyAnim.onArrive;
      flyAnim = null;
      if (controls) controls.enabled = true;
      if (arrive) arrive();
      return;
    }
    flyAnim.rafId = requestAnimationFrame(step);
  };
  flyAnim.rafId = requestAnimationFrame(step);
  return true;
}

export function initMoon() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const loaderEl = document.getElementById('loader');
  const loaderPercentEl = document.getElementById('loader-percent');

  // 5% 为步进的平滑进度动画
  let displayedProgress = 0;
  let targetProgress = 0;
  let progressInterval = null;
  let checkDoneInterval = null;

  function updateDisplayedProgress() {
    if (displayedProgress < targetProgress) {
      displayedProgress += 5;
      if (loaderPercentEl) {
        loaderPercentEl.textContent = `${displayedProgress}%`;
      }
    } else {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function setTargetProgress(value) {
    targetProgress = Math.min(100, Math.round(value / 5) * 5);
    if (!progressInterval) {
      progressInterval = setInterval(updateDisplayedProgress, 60);
    }
  }

  const loadingManager = new THREE.LoadingManager();
  loadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
    setTargetProgress((itemsLoaded / itemsTotal) * 100);
  };
  loadingManager.onLoad = () => {
    setTargetProgress(100);
    // 等待进度动画到达 100% 后再隐藏加载层
    checkDoneInterval = setInterval(() => {
      if (displayedProgress >= 100) {
        clearInterval(checkDoneInterval);
        checkDoneInterval = null;
        if (loaderEl) {
          loaderEl.classList.add('hidden');
          setTimeout(() => { if (loaderEl) loaderEl.style.display = 'none'; }, 800);
        }
      }
    }, 50);
  };

  const textureLoader = new THREE.TextureLoader(loadingManager);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x08080a, 0.032);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0.35, 3.2);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;
  controls.minDistance = 1.8;
  controls.maxDistance = 6;
  controls.enablePan = false;

  // Lighting: 月球感——冷白主光 + 极弱蓝色地球反照 + 银白边缘光
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.6);
  mainLight.position.set(5, 3, 5);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(2048, 2048);
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 20;
  mainLight.shadow.bias = -0.0005;
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.25);
  fillLight.position.set(-3, 0, -5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.18);
  rimLight.position.set(0, -5, 0);
  scene.add(rimLight);

  const ambientLight = new THREE.AmbientLight(0x303035, 0.35);
  scene.add(ambientLight);

  // Moon: 更偏灰白、低饱和的材质
  const isMobile = window.innerWidth < 768;
  const geometry = new THREE.SphereGeometry(1, isMobile ? 256 : 512, isMobile ? 256 : 512);

  const moonColor = textureLoader.load('textures/moon_color.jpg');
  const moonHeight = textureLoader.load('textures/moon_height.png');
  [moonColor, moonHeight].forEach(tex => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  });

  const moonMaterial = new THREE.MeshStandardMaterial({
    map: moonColor,
    displacementMap: moonHeight,
    displacementScale: 0.06,
    bumpMap: moonHeight,
    bumpScale: 0.03,
    roughness: 0.98,
    metalness: 0.02,
    color: 0xdddddd
  });

  moon = new THREE.Mesh(geometry, moonMaterial);
  moon.castShadow = true;
  moon.receiveShadow = true;
  moon.rotation.y = -Math.PI / 2;
  scene.add(moon);

  // Glow shell: 银白冷辉光，极低饱和度
  const glowGeometry = new THREE.SphereGeometry(1.08, 64, 64);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xcceeff,
    transparent: true,
    opacity: 0.035,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  glow = new THREE.Mesh(glowGeometry, glowMaterial);
  scene.add(glow);

  // Earth: 远处的小蓝白点，增强月球视角
  const earthGeometry = new THREE.SphereGeometry(0.08, 32, 32);
  const earthMaterial = new THREE.MeshBasicMaterial({
    color: 0x88bbff,
    transparent: true,
    opacity: 0.85
  });
  earth = new THREE.Mesh(earthGeometry, earthMaterial);
  earth.position.set(12, 3, -8);
  scene.add(earth);

  // Starfield: 更多银白星光
  const starCount = 4000;
  const starPositions = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const r = 25 + Math.random() * 35;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
    starSizes[i] = Math.random() * 1.5 + 0.3;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xe8eefc,
    size: 0.08,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true
  });
  stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);

  // Overlays for decisions
  overlayGroup = new THREE.Group();
  scene.add(overlayGroup);

  // Markers
  markerGroup = new THREE.Group();
  scene.add(markerGroup);

  bases.forEach(base => {
    const pos = latLonToVector3(base.lat, base.lon, 1.03);
    const normal = pos.clone().normalize();

    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 24, 24), new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    }));
    dot.position.copy(pos);
    dot.userData = { base, type: 'dot' };

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.045, 48), new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    ring.position.copy(pos);
    ring.lookAt(pos.clone().add(normal));
    ring.userData = { base, type: 'ring' };

    markerGroup.add(dot);
    markerGroup.add(ring);
    markers.push(dot, ring);
  });

  // Post processing
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    0.35,
    0.5,
    0.88
  );
  composer.addPass(bloomPass);

  // Interaction
  const tooltip = document.getElementById('marker-tooltip');
  // HUD 悬停卡跟随鼠标的惯性坐标（lerp 延迟，不瞬移）
  let tooltipX = 0, tooltipY = 0, tooltipTX = 0, tooltipTY = 0, tooltipShown = false;

  function buildHudHtml(base) {
    const illum = Math.max(0, Math.min(100, base.illumination ?? 0));
    const icePct = Math.max(0, Math.min(100, ((base.iceWt ?? 0) / 6) * 100));
    const slopePct = Math.max(0, Math.min(100, ((base.slope ?? 0) / 15) * 100));
    // 多基地网络：已规划基地显示部署进度，未规划基地引导开始规划
    const plannedIds = safePlannedSites(latestState);
    const decisions = plannedIds.includes(base.id) ? safeSiteDecisions(latestState, base.id) : null;
    const deployLine = decisions
      ? `<div class="moon-hud__deployed">已部署 ${safeCompletedSteps(decisions)}/6 系统</div>`
      : `<div class="moon-hud__deployed moon-hud__deployed--idle">点击开始规划</div>`;
    return `
      <div class="moon-hud__frame">
        <i class="moon-hud__corner moon-hud__corner--tl"></i>
        <i class="moon-hud__corner moon-hud__corner--tr"></i>
        <i class="moon-hud__corner moon-hud__corner--bl"></i>
        <i class="moon-hud__corner moon-hud__corner--br"></i>
        <div class="moon-hud__scan"></div>
        <div class="moon-hud__name">${base.name}</div>
        <div class="moon-hud__sub">${base.subtitle}</div>
        <div class="moon-hud__rows">
          <div class="moon-hud__row">
            <span class="moon-hud__label">光照</span>
            <span class="moon-hud__bar"><span class="moon-hud__fill" style="width:${illum}%"></span></span>
            <span class="moon-hud__value">${base.illumination}%</span>
          </div>
          <div class="moon-hud__row">
            <span class="moon-hud__label">水冰</span>
            <span class="moon-hud__bar"><span class="moon-hud__fill" style="width:${icePct}%"></span></span>
            <span class="moon-hud__value">${base.iceWt} wt%</span>
          </div>
          <div class="moon-hud__row">
            <span class="moon-hud__label">坡度</span>
            <span class="moon-hud__bar"><span class="moon-hud__fill" style="width:${slopePct}%"></span></span>
            <span class="moon-hud__value">${base.slope}°</span>
          </div>
        </div>
        ${deployLine}
        <div class="moon-hud__hint">点击开始推演 →</div>
      </div>`;
  }

  function showTooltip(base) {
    if (!tooltip) return;
    if (!tooltipShown) {
      // 首次出现时对齐目标位置，避免从远处飞入
      tooltipX = tooltipTX;
      tooltipY = tooltipTY;
    }
    tooltip.innerHTML = buildHudHtml(base);
    tooltip.className = 'moon-hud moon-hud--visible';
    tooltipShown = true;
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('moon-hud--visible');
    tooltipShown = false;
  }

  function onContainerClick(event) {
    const intersects = getIntersects(event.clientX, event.clientY, container);
    if (intersects.length > 0) {
      const base = intersects[0].object.userData.base;
      if (base) {
        window.dispatchEvent(new CustomEvent('marker-click', { detail: base }));
        controls.autoRotate = false;
      }
    }
  }

  function onContainerMouseMove(event) {
    // 待机视差目标（-1 ~ 1 归一化）
    const rect = container.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    parallaxTarget.set(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)));

    tooltipTX = event.clientX;
    tooltipTY = event.clientY;

    // 俯冲期间隐藏悬停卡并跳过拾取
    if (flyAnim) {
      hoverBaseId = null;
      hideTooltip();
      container.style.cursor = 'default';
      return;
    }

    const intersects = getIntersects(event.clientX, event.clientY, container);
    if (intersects.length > 0) {
      const base = intersects[0].object.userData.base;
      if (base) {
        if (hoverBaseId !== base.id) {
          // 进入新标记才发声，同一标记内 mousemove 不重复触发
          hoverBaseId = base.id;
          window.__moonFx?.sound('hover');
          showTooltip(base);
        }
        container.style.cursor = 'pointer';
      }
    } else {
      if (hoverBaseId !== null) hoverBaseId = null;
      hideTooltip();
      container.style.cursor = 'default';
    }
  }

  function onContainerMouseLeave() {
    parallaxTarget.set(0, 0);
    hoverBaseId = null;
    hideTooltip();
  }

  function onControlsStart() { controlsDragging = true; }
  function onControlsEnd() { controlsDragging = false; }

  function onWindowResize() {
    if (!container || !renderer) return;
    var width = container.clientWidth;
    var height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
    composer.passes.forEach(function (pass) {
      if (pass.setSize) pass.setSize(width, height);
    });
  }

  container.addEventListener('click', onContainerClick);
  container.addEventListener('mousemove', onContainerMouseMove);
  container.addEventListener('mouseleave', onContainerMouseLeave);
  controls.addEventListener('start', onControlsStart);
  controls.addEventListener('end', onControlsEnd);
  window.addEventListener('resize', onWindowResize);

  // Animation loop
  function animate() {
    animFrameId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    controls.update();
    stars.rotation.y += 0.0003;
    if (earth) earth.rotation.y += 0.0005;

    markerGroup.children.forEach(child => {
      if (child.userData.type === 'ring') {
        const phase = Math.sin(t * 3 + child.position.x);
        let scale = 1 + phase * 0.3;
        let opacity = 0.35 - phase * 0.15;
        const bid = child.userData.base?.id;
        // 悬停：环放大增亮
        if (bid && bid === hoverBaseId) {
          scale *= 1.6;
          opacity = Math.min(1, opacity + 0.5);
        }
        // 俯冲点亮脉冲（约 750ms 正弦包络）
        if (bid && markerPulse && markerPulse.baseId === bid) {
          const p = (performance.now() - markerPulse.start) / 750;
          if (p >= 1) {
            markerPulse = null;
          } else {
            const pulse = Math.sin(p * Math.PI);
            scale *= 1 + pulse * 1.8;
            opacity = Math.min(1, opacity + pulse * 0.65);
          }
        }
        child.scale.set(scale, scale, scale);
        child.material.opacity = opacity;
      }
    });

    // 补给弧线流光：每个 link 的光点串沿曲线参数循环前进
    for (let i = 0; i < flowArcs.length; i++) {
      const fa = flowArcs[i];
      const attr = fa.points.geometry.getAttribute('position');
      for (let j = 0; j < fa.count; j++) {
        const tt = (fa.offset + j / fa.count + t * fa.speed) % 1;
        const p = fa.curve.getPoint(tt);
        attr.setXYZ(j, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
    }

    // HUD 悬停卡：跟随鼠标的惯性延迟
    if (tooltip) {
      tooltipX += (tooltipTX - tooltipX) * 0.18;
      tooltipY += (tooltipTY - tooltipY) * 0.18;
      tooltip.style.left = tooltipX + 'px';
      tooltip.style.top = tooltipY + 'px';
    }

    // 待机视差：拖动 / 俯冲期间平滑归零，不影响 OrbitControls 状态
    const px = (controlsDragging || flyAnim) ? 0 : parallaxTarget.x;
    const py = (controlsDragging || flyAnim) ? 0 : parallaxTarget.y;
    parallaxCurrent.x += (px - parallaxCurrent.x) * 0.05;
    parallaxCurrent.y += (py - parallaxCurrent.y) * 0.05;

    glow.position.copy(moon.position);

    // 视差偏移仅在渲染瞬间施加，渲染后还原，避免污染 OrbitControls 的相机状态
    _parallaxRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _parallaxUp.setFromMatrixColumn(camera.matrixWorld, 1);
    _parallaxOffset.set(0, 0, 0)
      .addScaledVector(_parallaxRight, parallaxCurrent.x * 0.035)
      .addScaledVector(_parallaxUp, -parallaxCurrent.y * 0.028);
    camera.position.add(_parallaxOffset);
    composer.render();
    camera.position.sub(_parallaxOffset);
  }
  animate();

  // —— 返回清理函数 ——
  return function cleanupMoon() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    if (checkDoneInterval) {
      clearInterval(checkDoneInterval);
      checkDoneInterval = null;
    }
    // 取消进行中的俯冲动画与交互增强状态
    cancelFly();
    markerPulse = null;
    hoverBaseId = null;
    controlsDragging = false;
    parallaxTarget.set(0, 0);
    parallaxCurrent.set(0, 0);
    container.removeEventListener('click', onContainerClick);
    container.removeEventListener('mousemove', onContainerMouseMove);
    container.removeEventListener('mouseleave', onContainerMouseLeave);
    if (controls) {
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('end', onControlsEnd);
    }
    window.removeEventListener('resize', onWindowResize);
    container.style.cursor = 'default';
    if (tooltip) {
      tooltip.className = '';
      tooltip.innerHTML = '';
    }
    if (loaderEl) {
      loaderEl.classList.remove('hidden');
      loaderEl.style.display = '';
    }
    if (loaderPercentEl) {
      loaderPercentEl.textContent = '0%';
    }
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer = null;
    }
    if (scene) {
      scene.traverse(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(function (m) { disposeMaterial(m); });
          } else {
            disposeMaterial(obj.material);
          }
        }
      });
      scene = null;
    }
    if (composer) {
      composer.passes.forEach(function (pass) {
        if (pass.dispose) pass.dispose();
      });
      composer = null;
    }
    if (controls) {
      controls.dispose();
      controls = null;
    }
    markers.length = 0;
    flowArcs.length = 0;
    latestState = null;
    overlayGroup = null;
    selectedMarker = null;
    camera = null;
    moon = null;
    markerGroup = null;
    glow = null;
    stars = null;
    earth = null;
  };
}

function disposeMaterial(material) {
  if (material.map) material.map.dispose();
  if (material.bumpMap) material.bumpMap.dispose();
  if (material.displacementMap) material.displacementMap.dispose();
  if (material.normalMap) material.normalMap.dispose();
  if (material.specularMap) material.specularMap.dispose();
  if (material.alphaMap) material.alphaMap.dispose();
  if (material.envMap) material.envMap.dispose();
  material.dispose();
}

function getIntersects(clientX, clientY, container) {
  const rect = container.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(markers);
}

function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

// --- Site-specific overlays ---

const decisionColors = {
  energy: { nuclear: 0xffd700, solar: 0xffaa00, storage: 0x88ccff },
  water: { isru: 0x00aaff, earth: 0x888888, recycle: 0x00ffaa },
  radiation: { regolith: 0x8b4513, cave: 0x9932cc, hull: 0xaaaaaa },
  communication: { laser: 0xff0044, relay: 0x44ff44, direct: 0xeeeeee },
  habitat: { farm: 0x00ff66, supply: 0xffcc00, algae: 0x66ffcc },
  transport: { hopper: 0xff6600, mass: 0x0066ff, cable: 0xffcc66 }
};

// 补给资源配色与流速（光点沿弧线的参数速度，圈/秒）
const resourceColors = { water: 0x44bbff, power: 0xffbb33, food: 0x66ff99 };
const resourceSpeeds = { water: 0.09, power: 0.14, food: 0.06 };

// state.js 契约的安全封装：并行开发期间形状不符时不至于拖垮渲染
function safePlannedSites(state) {
  try { return (state && getPlannedSites(state)) || []; } catch (e) { return []; }
}
function safeSiteDecisions(state, siteId) {
  try { return (state && getSiteDecisions(state, siteId)) || null; } catch (e) { return null; }
}
function safeCompletedSteps(decisions) {
  try { return decisions ? getCompletedSteps(decisions) : 0; } catch (e) { return 0; }
}
function safeNetworkLinks(state) {
  try { return (state && computeNetworkMetrics(state)?.links) || []; } catch (e) { return []; }
}

function disposeObject(obj) {
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    if (Array.isArray(obj.material)) {
      obj.material.forEach(m => disposeMaterial(m));
    } else {
      disposeMaterial(obj.material);
    }
  }
}

function createSiteBeam(base, emphasis = 1) {
  const illumination = base.illumination ?? 50;
  const height = 0.12 + (illumination / 100) * 0.55;
  const geometry = new THREE.CylinderGeometry(0.012 * emphasis, 0.035 * emphasis, height, 16, 1, true);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.MeshBasicMaterial({
    color: base.tone,
    transparent: true,
    opacity: Math.min(1, 0.35 * emphasis),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.userData = { type: 'siteBeam' };
  return beam;
}

function createDecisionRing(radius, color, segments = 48) {
  const geometry = new THREE.TorusGeometry(radius, 0.006, 8, segments);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.userData = { type: 'decisionRing' };
  ring.renderOrder = 10;
  return ring;
}

function alignOverlayToSurface(overlay, lat, lon, surfaceRadius) {
  const pos = latLonToVector3(lat, lon, surfaceRadius);
  const normal = pos.clone().normalize();
  overlay.position.copy(pos);
  overlay.lookAt(pos.clone().add(normal));
  overlay.rotateX(Math.PI / 2);
}

// 补给弧线：3D 大圆弧 Tube + 沿曲线循环前进的流光点串
function createSupplyArc(link, fromBase, toBase) {
  const color = resourceColors[link.resource] ?? 0xffffff;
  const p0 = latLonToVector3(fromBase.lat, fromBase.lon, 1.03);
  const p2 = latLonToVector3(toBase.lat, toBase.lon, 1.03);

  // 中点抬升高度随两端角距缩放（两端同半径，angleTo 即角距）
  const angle = p0.angleTo(p2);
  const lift = 1.35 + Math.min(1, angle / Math.PI) * 0.15;
  const mid = p0.clone().add(p2).multiplyScalar(0.5).normalize().multiplyScalar(lift);
  const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);

  const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.004, 8, false);
  const tubeMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.userData = { type: 'supplyArc' };
  overlayGroup.add(tube);

  // 流光点串：12 个亮点沿曲线参数 t 循环流动，速度随资源类型略有差异
  const count = 12;
  const positions = new Float32Array(count * 3);
  const ptsGeo = new THREE.BufferGeometry();
  ptsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const ptsMat = new THREE.PointsMaterial({
    color,
    size: 0.022,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  const points = new THREE.Points(ptsGeo, ptsMat);
  points.userData = { type: 'flowPoints' };
  overlayGroup.add(points);

  flowArcs.push({
    curve,
    points,
    count,
    speed: resourceSpeeds[link.resource] ?? 0.08,
    offset: Math.random()
  });
}

const overlayTypes = ['siteBeam', 'decisionRing', 'supplyArc', 'flowPoints'];

function clearOverlays() {
  const toRemove = overlayGroup.children.filter(child => overlayTypes.includes(child.userData.type));
  toRemove.forEach(child => {
    disposeObject(child);
    overlayGroup.remove(child);
  });
  flowArcs.length = 0;
}

export function updateDecisionOverlays(state) {
  latestState = state || null; // HUD 悬停卡需要最新快照，即使月球未初始化也记录
  if (!overlayGroup) return;

  clearOverlays();
  if (!state) return;

  const plannedIds = safePlannedSites(state);

  plannedIds.forEach(siteId => {
    const base = bases.find(b => b.id === siteId);
    if (!base) return;
    const decisions = safeSiteDecisions(state, siteId);
    if (!decisions || safeCompletedSteps(decisions) < 1) return; // ≥1 项决策才点亮

    const isActive = state.activeSite === siteId;
    const emphasis = isActive ? 1.3 : 1;

    // 光柱（基地 tone 色；activeSite 略亮略粗）
    const beam = createSiteBeam(base, emphasis);
    alignOverlayToSurface(beam, base.lat, base.lon, 1.03);
    overlayGroup.add(beam);

    // 决策环：energy / water / radiation，按该基地自己的 decisions 取色
    const pos = latLonToVector3(base.lat, base.lon, 1.03);
    const normal = pos.clone().normalize();
    const ringConfigs = [
      { key: 'energy', radius: 0.14 },
      { key: 'water', radius: 0.19 },
      { key: 'radiation', radius: 0.24 }
    ];
    let ringIndex = 0;
    ringConfigs.forEach(({ key, radius }) => {
      const choice = decisions[key];
      if (!choice) return;
      const color = decisionColors[key]?.[choice] ?? 0xffffff;
      const ringPos = pos.clone().add(normal.clone().multiplyScalar(0.04 + ringIndex * 0.012));
      const ring = createDecisionRing(radius, color);
      ring.position.copy(ringPos);
      ring.lookAt(ringPos.clone().add(normal));
      overlayGroup.add(ring);
      ringIndex += 1;
    });
  });

  // 补给弧线：links 非空时为每条 link 画大圆弧 + 流光
  safeNetworkLinks(state).forEach(link => {
    const fromBase = bases.find(b => b.id === link.from);
    const toBase = bases.find(b => b.id === link.to);
    if (!fromBase || !toBase || fromBase === toBase) return;
    createSupplyArc(link, fromBase, toBase);
  });
}

export function highlightSite(siteId) {
  if (!markerGroup || !markerGroup.children) return;

  markerGroup.children.forEach(child => {
    const data = child.userData;
    if (data.type === 'dot') {
      child.material.color.setHex(0xffffff);
      child.scale.set(1, 1, 1);
    } else if (data.type === 'ring') {
      child.material.color.setHex(0xffffff);
    }
  });

  selectedMarker = siteId;
  if (!siteId) return;

  markerGroup.children.forEach(child => {
    const data = child.userData;
    if (data.base?.id === siteId) {
      const tone = data.base.tone || 0xffd700;
      if (data.type === 'dot') {
        child.material.color.setHex(tone);
        child.scale.set(1.7, 1.7, 1.7);
      } else if (data.type === 'ring') {
        child.material.color.setHex(tone);
      }
    }
  });
  // 光柱与决策环由 updateDecisionOverlays 统一按多基地网络渲染
}
