import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export const bases = [
  {
    id: 'shackleton',
    name: '沙克尔顿基地',
    subtitle: '极地科研前哨',
    desc: '位于月球南极沙克尔顿陨石坑边缘，这里是太阳系中最具价值的深空门户。永久阴影区富含水冰，可为基地提供饮用水、氧气和火箭燃料，支撑人类向火星及更远深空进发。',
    lat: -89.5,
    lon: 0,
    altitude: '+4,200 m',
    type: '永久驻留站',
    selectable: true,
    tone: 0x00d4ff
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
    tone: 0xe0e0e0
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
    tone: 0xffaa55
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
    tone: 0xc9a0ff
  }
];

let scene, camera, renderer, controls, composer, moon, markerGroup, glow, stars, earth;
let selectedMarker = null;
const markers = [];
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

export function initMoon() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const loaderEl = document.getElementById('loader');
  const loaderPercentEl = document.getElementById('loader-percent');

  // 5% 为步进的平滑进度动画
  let displayedProgress = 0;
  let targetProgress = 0;
  let progressInterval = null;

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
    const checkDone = setInterval(() => {
      if (displayedProgress >= 100) {
        clearInterval(checkDone);
        if (loaderEl) {
          loaderEl.classList.add('hidden');
          setTimeout(() => { loaderEl.style.display = 'none'; }, 800);
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

  container.addEventListener('click', event => {
    const intersects = getIntersects(event.clientX, event.clientY, container);
    if (intersects.length > 0) {
      const base = intersects[0].object.userData.base;
      if (base) {
        window.dispatchEvent(new CustomEvent('marker-click', { detail: base }));
        controls.autoRotate = false;
      }
    }
  });

  container.addEventListener('mousemove', event => {
    const intersects = getIntersects(event.clientX, event.clientY, container);
    if (intersects.length > 0) {
      const base = intersects[0].object.userData.base;
      if (tooltip) {
        tooltip.textContent = base.name;
        tooltip.style.left = event.clientX + 'px';
        tooltip.style.top = event.clientY + 'px';
        tooltip.classList.add('visible');
      }
      container.style.cursor = 'pointer';
    } else {
      tooltip?.classList.remove('visible');
      container.style.cursor = 'default';
    }
  });

  window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
    bloomPass.setSize(width, height);
  });

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    controls.update();
    stars.rotation.y += 0.0003;
    if (earth) earth.rotation.y += 0.0005;

    markerGroup.children.forEach(child => {
      if (child.userData.type === 'ring') {
        const scale = 1 + Math.sin(t * 3 + child.position.x) * 0.3;
        child.scale.set(scale, scale, scale);
        child.material.opacity = 0.35 - Math.sin(t * 3 + child.position.x) * 0.15;
      }
    });

    glow.position.copy(moon.position);
    composer.render();
  }
  animate();
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

export function highlightSite(siteId) {
  if (!markerGroup) return;

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
}
