// background.js
console.log("XREAL WebXR Background Service Worker loaded.");

let ws = null;
let activePorts = new Set();

function connectWebSocket() {
  console.log("Background: Connecting to pose server at ws://localhost:8080...");
  ws = new WebSocket('ws://localhost:8080');

  ws.onopen = () => {
    console.log("Background: Connected to localhost:8080 bridge!");
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      
      // 接続中のすべてのタブの content.js ポートへ姿勢データをブロードキャスト
      for (const port of activePorts) {
        try {
          port.postMessage(message);
        } catch (err) {
          activePorts.delete(port);
        }
      }
    } catch (e) {
      console.error("Background WS parsing error:", e);
    }
  };

  ws.onclose = () => {
    console.log("Background WS disconnected. Retrying in 3 seconds...");
    ws = null;
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

// 拡張機能のバックグラウンド権限で安全にWebSocketを常時接続
connectWebSocket();

// content.js からの接続コネクションを管理
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "xreal-bridge") {
    activePorts.add(port);
    console.log(`Background: Content script connected. Active ports: ${activePorts.size}`);

    // content.js から届いた要求 (キャリブレーション等) をローカルサーバーへ転送
    port.onMessage.addListener((msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    port.onDisconnect.addListener(() => {
      activePorts.delete(port);
      console.log(`Background: Content script disconnected. Active ports: ${activePorts.size}`);
    });
  }
});
