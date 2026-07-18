// Three.js 3D WebXR Sandbox & Dashboard Controller
let scene, camera, renderer;
let cube, gridHelper, torus;
let xrSession = null;

// キャリブレーション補正値
let offsetPosition = { x: 0, y: 0, z: 0 };
let offsetYaw = 0;

function init() {
  const container = document.getElementById('canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  // 1. シーンのセットアップ
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010204);
  scene.fog = new THREE.FogExp2(0x010204, 0.08);

  // 2. カメラのセットアップ
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(0, 1.6, 3);

  // 3. レンダラーのセットアップ
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true; // WebXR (ポリフィル) を有効化
  container.appendChild(renderer.domElement);

  // 4. ライティング (ネオンテイスト)
  const ambientLight = new THREE.AmbientLight(0x1e1b4b, 1.5); // 深い青紫の環境光
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0x06b6d4, 2.5); // シアンの平行光
  dirLight1.position.set(2, 4, 3);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xa855f7, 2.0); // パープルの平行光
  dirLight2.position.set(-2, -1, -3);
  scene.add(dirLight2);

  // 5. グリッドと空間マーカー (6DoF移動が視覚的に伝わりやすくする)
  gridHelper = new THREE.GridHelper(40, 40, 0x06b6d4, 0x1e293b);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  // 中央の立方体 (ネオン調ホログラム)
  const cubeGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const cubeMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0x0891b2,
    emissiveIntensity: 0.5
  });
  cube = new THREE.Mesh(cubeGeo, cubeMat);
  cube.position.set(0, 1.6, -1.5);
  scene.add(cube);

  // 周囲を回るトーラス
  const torusGeo = new THREE.TorusGeometry(0.8, 0.05, 16, 100);
  const torusMat = new THREE.MeshStandardMaterial({
    color: 0xa855f7,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0x7e22ce,
    emissiveIntensity: 0.3
  });
  torus = new THREE.Mesh(torusGeo, torusMat);
  torus.position.set(0, 1.6, -1.5);
  torus.rotation.x = Math.PI / 2;
  scene.add(torus);

  // ランダムな空間パーティクル
  const particlesGeo = new THREE.BufferGeometry();
  const particlesCount = 200;
  const posArray = new Float32Array(particlesCount * 3);

  for(let i=0; i < particlesCount * 3; i++) {
    posArray[i] = (Math.random() - 0.5) * 15;
  }

  particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  const particlesMat = new THREE.PointsMaterial({
    size: 0.04,
    color: 0xf472b6,
    transparent: true,
    opacity: 0.8
  });
  const particles = new THREE.Points(particlesGeo, particlesMat);
  scene.add(particles);

  // 6. レンダリングループの開始
  renderer.setAnimationLoop(render);

  // 7. リサイズイベント
  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// 描画ループ
let frameCount = 0;
function render(timestamp, frame) {
  frameCount++;

  // 非WebXRモードの時は通常のカメラを自転移動させる
  if (!renderer.xr.isPresenting) {
    const time = timestamp * 0.001;
    cube.rotation.x = time * 0.5;
    cube.rotation.y = time * 0.8;
    torus.rotation.z = time * 0.2;
  } else {
    // WebXRセッション起動中は、ポリフィルからの6DoF座標が自動で適用されます
    cube.rotation.y += 0.01;
  }

  renderer.render(scene, camera);
}

// WebXRの開始/終了ボタン制御
async function toggleXR() {
  if (xrSession === null) {
    // セッション開始
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor']
      });
      
      renderer.xr.setSession(session);
      xrSession = session;
      
      document.getElementById('enter-vr').innerHTML = `<span>EXIT WEBXR</span>`;
      document.getElementById('vr-status').innerText = "VR MODE ACTIVE (SBS)";
      
      // 自動フルスクリーン化 (キャンバス単体をフルスクリーン化して操作UIなどを非表示にする)
      const canvas = renderer.domElement;
      if (canvas.requestFullscreen) {
        await canvas.requestFullscreen();
      } else if (canvas.webkitRequestFullscreen) {
        await canvas.webkitRequestFullscreen();
      }
      
      // フルスクリーン解除のイベントを検知してWebXRセッションも同期終了させる
      const onFullscreenChange = () => {
        if (!document.fullscreenElement && xrSession) {
          xrSession.end();
        }
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      
      session.onend = () => {
        xrSession = null;
        document.getElementById('enter-vr').innerHTML = `<span>ENTER WEBXR</span>`;
        document.getElementById('vr-status').innerText = "FULLSCREEN SIDE-BY-SIDE";
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        
        // フルスクリーンを抜ける
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(err => console.warn(err));
        }
      };
    } catch (e) {
      console.error("WebXR session request failed:", e);
      alert("WebXRセッションの起動に失敗しました: " + e.message);
    }
  } else {
    // セッション終了
    xrSession.end();
  }
}

// 8. ポリフィルからのトラッキング更新イベントの検知 ＆ UI表示更新
window.addEventListener('xreal-pose-update', (event) => {
  const { pose, source } = event.detail;

  // ダッシュボードUIのテレメトリ表示を更新
  document.getElementById('pos-x').innerText = pose.position.x.toFixed(4);
  document.getElementById('pos-y').innerText = pose.position.y.toFixed(4);
  document.getElementById('pos-z').innerText = pose.position.z.toFixed(4);

  // クォータニオンから高精度にオイラー角へ変換してUI表示
  const THREE_q = new THREE.Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);
  const euler = new THREE.Euler().setFromQuaternion(THREE_q, 'YXZ');
  
  const pitch = euler.x * 180 / Math.PI;
  const yaw = euler.y * 180 / Math.PI;
  const roll = euler.z * 180 / Math.PI;

  document.getElementById('rot-p').innerText = pitch.toFixed(2) + '°';
  document.getElementById('rot-y').innerText = yaw.toFixed(2) + '°';
  document.getElementById('rot-r').innerText = roll.toFixed(2) + '°';

  // 接続ステータスのドット色
  const dot = document.getElementById('status-dot');
  const sourceLabel = document.getElementById('tracking-source');
  
  if (source === 'disconnected' || source === 'none') {
    dot.className = 'status-dot';
    sourceLabel.innerText = 'WAITING';
  } else {
    dot.className = 'status-dot online';
    if (source === 'simulator') {
      sourceLabel.innerText = 'SIMULATOR ACTIVE';
    } else if (source === 'xreal-imu') {
      sourceLabel.innerText = 'XREAL IMU (3DoF)';
    } else if (source === 'android-native') {
      sourceLabel.innerText = 'ANDROID NATIVE (6DoF)';
    } else if (source === 'external') {
      sourceLabel.innerText = 'EXTERNAL SLAM (6DoF)';
    }
  }
});

// UIコントロールのイベント登録
document.addEventListener('DOMContentLoaded', () => {
  init();

  const enterVrBtn = document.getElementById('enter-vr');
  enterVrBtn.addEventListener('click', toggleXR);

  // トラッキングソース変更
  const sourceSelect = document.getElementById('source-select');
  sourceSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    localStorage.setItem('xreal_tracking_source', val);
    
    // ポリフィル経由でWebSocketメッセージを送信
    if (window.XrealWebXR && typeof window.XrealWebXR.send === 'function') {
      const sent = window.XrealWebXR.send({ type: 'set_source', source: val });
      if (!sent) {
        console.warn("WebSocket is not connected. Failed to set source.");
      }
    }
  });

  // 保存されたトラッキングソースの復元
  const savedSource = localStorage.getItem('xreal_tracking_source');
  if (savedSource) {
    sourceSelect.value = savedSource;
    // 起動時にWebSocket接続が確立するのを見越して送信
    setTimeout(() => {
      if (window.XrealWebXR && typeof window.XrealWebXR.send === 'function') {
        window.XrealWebXR.send({ type: 'set_source', source: savedSource });
      }
    }, 1000);
  }

  // IPD調整
  const ipdInput = document.getElementById('ipd-input');
  ipdInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (window.XrealWebXR && !isNaN(val)) {
      window.XrealWebXR.setIPD(val / 1000.0); // mm から m へ
    }
  });
  // キャリブレーション（原点リセット）
  const calBtn = document.getElementById('btn-calibrate');
  calBtn.addEventListener('click', () => {
    console.log("Calibration clicked");
    alert("原点キャリブレーションを実行しました。現在位置を基準にセットします。");
  });
});

// === プロトコルアナライザー (Hexデコーダー ＆ センサーフュージョン演算) ===
let lastPacketBytes = [];
let lastHexRenderTime = 0; // 描画スロットリング用のタイマー

// キャリブレーション開始 (サーバー側に要求を送信)
function startGyroCalibration() {
  console.log("Requesting gyro calibration from server... Keep glasses still.");
  if (window.XrealWebXR && typeof window.XrealWebXR.send === 'function') {
    window.XrealWebXR.send({ type: 'calibrate' });
  }
}

// ユーザーがキャリブレーションボタンを押したとき
window.addEventListener('load', () => {
  const calBtn = document.getElementById('btn-calibrate');
  if (calBtn) {
    calBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startGyroCalibration();
    });
  }
});

window.addEventListener('xreal-raw-packet', (event) => {
  const { length, bytes } = event.detail;
  
  // 1. TCPパケット結合対策: 134バイト未満は無視し、それ以上なら「最新の134バイト」を切り出す
  if (bytes.length < 134) return;
  const lastPacket = bytes.slice(bytes.length - 134);
  
  // アナライザーパネルを表示
  const panel = document.getElementById('binary-analyzer-panel');
  if (panel && panel.style.display === 'none') {
    panel.style.display = 'block';
  }
  
  document.getElementById('packet-length').innerText = length;
  
  // 2. Hexダンプの描画 (100msに1回＝10Hzにスロットリングして描画負荷を激減させる)
  const nowTime = performance.now();
  if (nowTime - lastHexRenderTime > 100) {
    lastHexRenderTime = nowTime;
    
    const container = document.getElementById('hex-container');
    if (container) {
      let html = '';
      for (let i = 0; i < lastPacket.length; i++) {
        const byteHex = lastPacket[i].toString(16).toUpperCase().padStart(2, '0');
        let isChanged = false;
        if (lastPacketBytes.length > i && lastPacketBytes[i] !== lastPacket[i]) {
          isChanged = true;
        }
        let isHeader = false;
        if (i < 6 && (lastPacket[0] === 0x27 || lastPacket[0] === 0x28) && lastPacket[1] === 0x36 && lastPacket[2] === 0x00 && lastPacket[3] === 0x00 && lastPacket[4] === 0x00 && lastPacket[5] === 0x80) {
          isHeader = true;
        }
        
        let colorClass = '';
        if (isHeader) {
          colorClass = 'color: var(--accent-pink); font-weight: bold;';
        } else if (isChanged) {
          colorClass = 'color: var(--accent-cyan); font-weight: bold; background: rgba(6, 182, 212, 0.15);';
        }
        
        html += `<span class="byte" style="${colorClass}">${byteHex}</span>`;
        
        if ((i + 1) % 16 === 0) {
          html += '<br/>';
        }
      }
      container.innerHTML = html;
    }
    lastPacketBytes = Array.from(lastPacket);
  }
});

