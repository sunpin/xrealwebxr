// popup.js
console.log("XREAL WebXR popup script loaded.");

const bridgeDot = document.getElementById('bridge-dot');
const bridgeStatus = document.getElementById('bridge-status');
const sourceName = document.getElementById('source-name');
const sbsToggle = document.getElementById('sbs-toggle');
const btnCalibrate = document.getElementById('btn-calibrate');

// 1. ローカルブリッジ（WebSocket）接続による状態監視
let ws = null;
function connectBridgeMonitor() {
  ws = new WebSocket('ws://localhost:8080');

  ws.onopen = () => {
    bridgeDot.className = 'status-dot online';
    bridgeStatus.innerText = 'CONNECTED';
    bridgeStatus.style.color = '#22c55e';
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'pose') {
        let sourceText = message.source.toUpperCase();
        if (message.source === 'xreal-imu') {
          sourceText = 'XREAL GLASSES (3DoF)';
        } else if (message.source === 'simulator') {
          sourceText = 'SIMULATOR (Auto)';
        }
        sourceName.innerText = sourceText;
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    bridgeDot.className = 'status-dot';
    bridgeStatus.innerText = 'OFFLINE';
    bridgeStatus.style.color = '#ef4444';
    sourceName.innerText = 'UNKNOWN';
    ws = null;
    // 2秒後に再接続
    setTimeout(connectBridgeMonitor, 2000);
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

// 2. 現在のタブの2D SBSミラーモード状態の取得
function checkTabSbsStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'check_sbs_status' }, (response) => {
      if (chrome.runtime.lastError) {
        // コンテンツスクリプトがまだロードされていない、または非ウェブページ（chrome://等）
        sbsToggle.disabled = true;
        return;
      }
      if (response && typeof response.enabled === 'boolean') {
        sbsToggle.checked = response.enabled;
      }
    });
  });
}

// 3. トグルスイッチ操作時のメッセージ送信
sbsToggle.addEventListener('change', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return;
    chrome.tabs.sendMessage(tabs[0].id, { 
      type: 'toggle_sbs_2d', 
      enabled: sbsToggle.checked 
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to send toggle message:", chrome.runtime.lastError);
      }
    });
  });
});

// 4. 原点キャリブレーション処理
btnCalibrate.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'calibrate' }));
    console.log("Calibration request sent directly via WebSocket.");
    alert("原点キャリブレーション要求を送信しました。グラスを1秒間静止させてください。");
  } else {
    alert("ローカルブリッジサーバー（OFFLINE）との通信が確立されていません。サーバーが起動しているかご確認ください。");
  }
});

// 初期化開始
connectBridgeMonitor();
checkTabSbsStatus();
