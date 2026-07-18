const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');

const PORT = process.env.PORT || 8080;
const XREAL_IP = '169.254.2.1';
const XREAL_PORT = 52998;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// クォータニオン数学演算ユーティリティ
function multiplyQuaternions(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function normalizeQuaternion(q) {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

function setFromEulerYXZ(x, y, z) {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);

  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3
  };
}

// 姿勢演算状態
let currentOrientation = { x: 0, y: 0, z: 0, w: 1 };
let gyroBias = { x: 0, y: 0, z: 0 };
let isCalibrating = false;
let calibrationSamples = [];
let lastTimestamp = 0;

// グローバル姿勢データ
let currentPose = {
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 }
};

let trackingSource = 'simulator'; // 'simulator', 'xreal-imu', 'external'

// 外部6DoFトラッカー用受信用API
app.post('/api/pose', (req, res) => {
  const { position, orientation } = req.body;
  if (position) currentPose.position = position;
  if (orientation) currentPose.orientation = orientation;
  trackingSource = 'external';
  res.status(200).json({ status: 'ok', source: trackingSource });
});

// シミュレータ姿勢生成ループ
let simTime = 0;
setInterval(() => {
  if (trackingSource === 'simulator') {
    simTime += 0.01;
    currentPose.position.x = Math.sin(simTime * 1.5) * 0.4;
    currentPose.position.y = 1.6 + Math.sin(simTime * 2.0) * 0.15;
    currentPose.position.z = -1.0 + Math.cos(simTime * 1.0) * 0.3;

    const yaw = Math.sin(simTime * 0.8) * 0.25;
    const pitch = Math.sin(simTime * 1.2) * 0.15;
    const roll = Math.sin(simTime * 2.0) * 0.05;

    const c1 = Math.cos(yaw / 2);
    const s1 = Math.sin(yaw / 2);
    const c2 = Math.cos(pitch / 2);
    const s2 = Math.sin(pitch / 2);
    const c3 = Math.cos(roll / 2);
    const s3 = Math.sin(roll / 2);

    currentPose.orientation.w = c1 * c2 * c3 - s1 * s2 * s3;
    currentPose.orientation.x = s1 * s2 * c3 + c1 * c2 * s3;
    currentPose.orientation.y = s1 * c2 * c3 + c1 * s2 * s3;
    currentPose.orientation.z = c1 * s2 * c3 - s1 * c2 * s3;
  }
}, 16);

// Xrealグラス IMU接続 (TCPポート 52998)
let xrealSocket = null;
let rawPacketLogCount = 0; // デバッグ用カウンタ

function connectToXreal() {
  console.log(`Connecting to Xreal glasses at ${XREAL_IP}:${XREAL_PORT}...`);
  xrealSocket = new net.Socket();

  xrealSocket.connect(XREAL_PORT, XREAL_IP, () => {
    console.log('Connected to Xreal glasses via TCP!');
    rawPacketLogCount = 0; // 接続時にカウンタをリセット
    trackingSource = 'xreal-imu'; // グラスが繋がったら自動的にIMUソースにする
  });

  xrealSocket.on('data', (data) => {
    try {
      // 最初の5パケットだけ、サーバー側のターミナルに生Hexを出力して解析する
      if (rawPacketLogCount < 5) {
        rawPacketLogCount++;
        console.log(`[ANALYZER RAW PACKET ${rawPacketLogCount}] Length: ${data.length} bytes`);
        console.log(`Hex: ${data.toString('hex')}`);
      }

      // 接続中のブラウザすべてに「生のバイナリデータ」をWebSocketで一斉配信
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'raw_packet',
            length: data.length,
            bytes: Array.from(data)
          }));
        }
      });

      // サーバー側でのバイナリパース ＆ クォータニオン姿勢計算
      const gyroOffset = 34;
      const accOffset = 46;
      
      if (data.length >= gyroOffset + 12 && data.length >= accOffset + 12) {
        const ax = data.readFloatLE(accOffset);
        const ay = data.readFloatLE(accOffset + 4);
        const az = data.readFloatLE(accOffset + 8);
        
        let gx = data.readFloatLE(gyroOffset);
        let raw_gy = data.readFloatLE(gyroOffset + 4);
        let raw_gz = data.readFloatLE(gyroOffset + 8);
        
        // 元の正しいマッピングに復元
        let gy = -raw_gy;
        let gz = -raw_gz;
        
        // NaN防御
        if (!isNaN(ax) && !isNaN(ay) && !isNaN(az) && !isNaN(gx) && !isNaN(raw_gy) && !isNaN(raw_gz)) {
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
              console.log("Server calibration complete. Gyro bias offsets:", gyroBias);
              currentOrientation = { x: 0, y: 0, z: 0, w: 1 };
            }
          } else {
            // 静止時バイアス減算
            gx -= gyroBias.x;
            gy -= gyroBias.y;
            gz -= gyroBias.z;
            
            // グラスの物理的な前傾マウント角（約13度）を相殺するチルト補正（X軸回転）
            const tiltAngle = 13.0 * Math.PI / 180.0;
            const cosT = Math.cos(tiltAngle);
            const sinT = Math.sin(tiltAngle);
            
            const gyAligned = gy * cosT - gz * sinT;
            const gzAligned = gy * sinT + gz * cosT;
            
            gy = gyAligned;
            gz = gzAligned;
            
            // dtの計算
            const now = Date.now();
            const dt = lastTimestamp ? (now - lastTimestamp) / 1000.0 : 0.01;
            lastTimestamp = now;
            
            if (dt > 0 && dt < 0.1) {
              const q_delta = setFromEulerYXZ(gx * dt, gy * dt, gz * dt);
              currentOrientation = multiplyQuaternions(currentOrientation, q_delta);
              currentOrientation = normalizeQuaternion(currentOrientation);
              
              // デバッグ用：100パケットごとに計算中の姿勢を出力
              if (!global.packetCount) global.packetCount = 0;
              global.packetCount++;
              if (global.packetCount % 100 === 0) {
                console.log(`[IMU Active] Quaternion: w=${currentOrientation.w.toFixed(4)}, x=${currentOrientation.x.toFixed(4)}, y=${currentOrientation.y.toFixed(4)}, z=${currentOrientation.z.toFixed(4)}`);
              }
              
              if (trackingSource === 'xreal-imu') {
                currentPose.position.x = 0;
                currentPose.position.y = 0;
                currentPose.position.z = 0;
                currentPose.orientation = currentOrientation;
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Error handling raw Xreal data:', e);
    }
  });

  xrealSocket.on('close', () => {
    console.log('Xreal connection closed. Retrying in 5 seconds...');
    if (trackingSource === 'xreal-imu') trackingSource = 'simulator';
    setTimeout(connectToXreal, 5000);
  });

  xrealSocket.on('error', (err) => {
    if (trackingSource === 'xreal-imu') trackingSource = 'simulator';
  });
}

// 接続ループの開始
connectToXreal();

// WebSockets姿勢配信
wss.on('connection', (ws) => {
  console.log('Browser WebXR client connected via WebSocket!');
  
  const senderInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'pose',
        source: trackingSource,
        pose: currentPose
      }));
    }
  }, 11); // 約90fps

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'set_source') {
        trackingSource = data.source;
        console.log(`Tracking source changed to: ${trackingSource}`);
      } else if (data.type === 'update_orientation') {
        currentPose.orientation = data.orientation;
      } else if (data.type === 'calibrate') {
        isCalibrating = true;
        calibrationSamples = [];
        console.log("Server calibration triggered via WebSocket client.");
      }
    } catch (e) {
      console.error('WebSocket message parse error:', e);
    }
  });

  ws.on('close', () => {
    clearInterval(senderInterval);
    console.log('Browser WebXR client disconnected.');
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Xreal WebXR 6DoF Bridge Server is running!`);
  console.log(` Web Dashboard: http://localhost:${PORT}`);
  console.log(` WebSocket Port: ${PORT}`);
  console.log(`====================================================`);
});
