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

  // クォータニオンからオイラー角(簡略)へ変換してUI表示
  const qx = pose.orientation.x;
  const qy = pose.orientation.y;
  const qz = pose.orientation.z;
  const qw = pose.orientation.w;
  
  // オイラー角近似
  const pitch = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)) * 180 / Math.PI;
  const yaw = Math.asin(2 * (qw * qy - qz * qx)) * 180 / Math.PI;
  const roll = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * 180 / Math.PI;

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

// センサーフュージョン（姿勢）の状態変数
let filterPitch = 0;
let filterYaw = 0;
let filterRoll = 0;
let lastTimestamp = 0;


// ジャイロのキャリブレーション（静止時バイアスの相殺）
let gyroBias = { x: 0, y: 0, z: 0 };
let calibrationSamples = [];
let isCalibrating = false;

// キャリブレーション開始
function startGyroCalibration() {
  isCalibrating = true;
  calibrationSamples = [];
  console.log("Starting gyro calibration... Keep glasses still.");
}

// ユーザーがキャリブレーションボタンを押したとき
window.addEventListener('load', () => {
  const calBtn = document.getElementById('btn-calibrate');
  if (calBtn) {
    // 既存のイベントリスナーは上書きされるか追加される
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
        
        const className = `byte${isChanged ? ' changed' : ''}${isHeader ? ' header' : ''}`;
        html += `<span class="${className}">${byteHex}</span>`;
        
        if ((i + 1) % 16 === 0) {
          html += '<br/>';
        }
      }
      container.innerHTML = html;
    }
  }
  
  lastPacketBytes = [...lastPacket];
  
  // 3. データバッファの構築
  const buffer = new ArrayBuffer(lastPacket.length);
  const view = new DataView(buffer);
  lastPacket.forEach((b, idx) => view.setUint8(idx, b));
  
  // 入力されたオフセットを取得 (加速度=46, ジャイロ=34)
  const accOffset = parseInt(document.getElementById('acc-offset-input').value) || 46;
  const gyroOffset = parseInt(document.getElementById('gyro-offset-input').value) || 34;
  
  try {
    if (lastPacket.length >= gyroOffset + 12 && lastPacket.length >= accOffset + 12) {
      // Xrealの内部IMU配置に合わせて軸をマッピング
      const ax = view.getFloat32(accOffset, true);
      const ay = view.getFloat32(accOffset + 4, true);
      const az = view.getFloat32(accOffset + 8, true);
      
      let gx = view.getFloat32(gyroOffset, true);      // 1番目のデータ(offset 34)を Pitch (gx) にマップ
      let gy = -view.getFloat32(gyroOffset + 4, true); // 2番目のデータ(offset 38)を反転させて Yaw (gy) にマップ
      let gz = -view.getFloat32(gyroOffset + 8, true); // 3番目のデータ(offset 42)を反転させて Roll (gz) にマップ
      
      // 【超重要】起動直後の NaN パケットの防御: 1つでも NaN があれば加算をスキップしてスルー
      if (isNaN(ax) || isNaN(ay) || isNaN(az) || isNaN(gx) || isNaN(gy) || isNaN(gz)) {
        return;
      }
      
      // デバッグ用ログ：100フレーム（約1秒）に1回出力
      if (Math.random() < 0.01) {
        console.log("【XREAL センサーデバッグ】");
        console.log("  - 加速度 (X, Y, Z):", [ax, ay, az]);
        console.log("  - ジャイロ (X, Y, Z):", [gx, gy, gz]);
      }

      // ジャイロのキャリブレーションサンプリング中
      if (isCalibrating) {
        calibrationSamples.push({ x: gx, y: gy, z: gz });
        if (calibrationSamples.length >= 100) {
          const sumX = calibrationSamples.reduce((sum, s) => sum + s.x, 0);
          const sumY = calibrationSamples.reduce((sum, s) => sum + s.y, 0);
          const sumZ = calibrationSamples.reduce((sum, s) => sum + s.z, 0);
          gyroBias.x = sumX / calibrationSamples.length;
          gyroBias.y = sumY / calibrationSamples.length;
          gyroBias.z = sumZ / calibrationSamples.length;
          isCalibrating = false;
          console.log("Calibration complete. Gyro bias offsets:", gyroBias);
          filterPitch = 0;
          filterYaw = 0;
          filterRoll = 0;
        }
        return; 
      }
      
      // 生の角速度から静止時バイアスを引く
      gx -= gyroBias.x;
      gy -= gyroBias.y;
      gz -= gyroBias.z;
      
      // 時間経過（デルタタイム）の計算
      const now = performance.now();
      const dt = lastTimestamp ? (now - lastTimestamp) / 1000.0 : 0.01;
      lastTimestamp = now;
      
      // 極端なタイムラグや不正値の保護
      if (dt <= 0 || dt > 0.1) return;
      
      // 4. 姿勢演算 (純粋なジャイロの積分によるトラッキング)
      // 加速度のノイズや特異点（NaN/180度ジャンプ）を排除するため、加速度による補正をオフにし、
      // キャリブレーション済みの高精度ジャイロ積分のみで3DoFを追従させます。
      filterPitch = filterPitch + gx * dt;
      filterRoll = filterRoll + gz * dt;
      filterYaw = filterYaw + gy * dt;

      // デバッグ用：100フレーム（約1秒）に1回、数値をコンソールに出力
      if (Math.random() < 0.01) {
        console.log("デバッグログ (Float32 Fusion):", {
          "経過時間 (dt)": dt,
          "計算角度 (Pitch, Yaw, Roll)": [filterPitch, filterYaw, filterRoll]
        });
      }
      
      // 5. Three.jsの標準関数を用いて安全にクォータニオンへ変換 (軸の混信を完全排除)
      // THREE.Eulerの引数順は (x, y, z, order) -> (Pitch, Yaw, Roll, 'YXZ')
      const THREE_euler = new THREE.Euler(filterPitch, filterYaw, filterRoll, 'YXZ');
      const THREE_q = new THREE.Quaternion().setFromEuler(THREE_euler);

      const q = {
        x: THREE_q.x,
        y: THREE_q.y,
        z: THREE_q.z,
        w: THREE_q.w
      };
      
      // 6. ポリフィルに適用 & サーバー経由でブラウザ側に姿勢データを逆同期
      if (window.XrealWebXR && typeof window.XrealWebXR.updateOrientation === 'function') {
        window.XrealWebXR.updateOrientation(q);
      }
    }
  } catch (err) {
    console.error("Fusion parser error:", err);
  }
});

