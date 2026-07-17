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

// グローバル姿勢データ
let currentPose = {
  position: { x: 0, y: 1.6, z: 0 },
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

      if (trackingSource === 'xreal-imu') {
        currentPose.position.x = 0;
        currentPose.position.y = 1.6;
        currentPose.position.z = 0;
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
