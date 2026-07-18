// content.js
console.log("XREAL WebXR Bridge content script loaded.");

// バックグラウンド・サービスワーカー経由の姿勢データ中継パイプライン構築
let bgPort = null;
try {
  bgPort = chrome.runtime.connect({ name: "xreal-bridge" });
  
  bgPort.onMessage.addListener((message) => {
    // 届いた姿勢データをそのままメインワールドの inject.js へリレー
    if (message.type === 'pose') {
      window.postMessage({
        type: 'XREAL_INJECT_POSE',
        pose: message.pose,
        source: message.source
      }, '*');
    }
  });
} catch (err) {
  console.error("XREAL Bridge: Failed to connect to background service worker:", err);
}

// メインワールド（inject.js）からの送信メッセージを中継してバックグラウンドへ転送
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'XREAL_FORWARD_TO_SERVER') {
    if (bgPort) {
      bgPort.postMessage(event.data.data);
    }
  }
});

// 2. SBS 2D ミラーモード用の状態変数
let sbsContainer = null;
let customCursorLeft = null;
let customCursorRight = null;

// 要素を一意に特定するためのCSSセレクター生成ヘルパー
function getUniqueSelector(el) {
  if (!el) return null;
  if (el.id) return `#${el.id}`;
  let path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.className) {
      // クラス名から空白を除外して結合
      const classes = Array.from(el.classList).filter(c => c.trim().length > 0);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }
    // 同名兄弟要素の中でのインデックス取得
    let sibling = el;
    let sibIndex = 1;
    while (sibling = sibling.previousElementSibling) {
      if (sibling.nodeName === el.nodeName) sibIndex++;
    }
    if (sibIndex > 1) {
      selector += `:nth-of-type(${sibIndex})`;
    }
    path.unshift(selector);
    el = el.parentNode;
  }
  return path.join(' > ');
}

// 2D SBS ミラーモードのトグル
function toggleSbs2dMode(enabled) {
  if (enabled) {
    if (document.getElementById('xreal-sbs-overlay')) return; // 既に有効な場合はスルー

    console.log("XREAL SBS 2D Mirror Mode: Enabled");

    // 全画面オーバーレイコンテナの作成
    sbsContainer = document.createElement('div');
    sbsContainer.id = 'xreal-sbs-overlay';
    sbsContainer.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      display: flex !important;
      flex-direction: row !important;
      z-index: 999999999 !important;
      background: #000 !important;
      overflow: hidden !important;
      cursor: none !important;
    `;

    // 左右のiframeの構築
    const pageUrl = window.location.href;
    const iframeLeft = document.createElement('iframe');
    iframeLeft.id = 'xreal-iframe-left';
    iframeLeft.src = pageUrl;
    iframeLeft.style.cssText = `
      width: 50vw !important;
      height: 100vh !important;
      border: none !important;
      background: white !important;
    `;

    const iframeRight = document.createElement('iframe');
    iframeRight.id = 'xreal-iframe-right';
    iframeRight.src = pageUrl;
    iframeRight.style.cssText = `
      width: 50vw !important;
      height: 100vh !important;
      border: none !important;
      background: white !important;
      pointer-events: none !important; /* 右目はマウス入力を完全に無効化 */
    `;

    // 3D立体視用カスタムカーソルの構築
    customCursorLeft = document.createElement('div');
    customCursorLeft.style.cssText = `
      position: fixed;
      width: 12px;
      height: 12px;
      background: #06b6d4;
      border: 2px solid white;
      border-radius: 50%;
      pointer-events: none;
      z-index: 1000000000;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 8px rgba(6, 182, 212, 0.8);
      display: none;
    `;

    customCursorRight = customCursorLeft.cloneNode(true);
    customCursorRight.style.background = '#ec4899'; // 識別用に別色にする（脳内で合体して一つに見えます）

    sbsContainer.appendChild(iframeLeft);
    sbsContainer.appendChild(iframeRight);
    sbsContainer.appendChild(customCursorLeft);
    sbsContainer.appendChild(customCursorRight);

    document.documentElement.appendChild(sbsContainer);

    // 左画面のインタラクションの右画面への完全同期
    const syncIframeActions = () => {
      try {
        const leftWin = iframeLeft.contentWindow;
        const rightWin = iframeRight.contentWindow;
        const leftDoc = leftWin.document;
        const rightDoc = rightWin.document;

        // 1. 各iframeの内部でもシステムカーソルを隠す
        const cursorStyle = leftDoc.createElement('style');
        cursorStyle.innerHTML = `* { cursor: none !important; }`;
        leftDoc.head.appendChild(cursorStyle);
        
        const cursorStyleRight = rightDoc.createElement('style');
        cursorStyleRight.innerHTML = `* { cursor: none !important; }`;
        rightDoc.head.appendChild(cursorStyleRight);

        // 2. スクロールの同期
        leftWin.addEventListener('scroll', () => {
          rightWin.scrollTo(leftWin.scrollX, leftWin.scrollY);
        }, { passive: true });

        // 3. テキスト入力のリアルタイム同期 (keyup/input両方検知)
        const onInputSync = (e) => {
          const selector = getUniqueSelector(e.target);
          if (selector) {
            const targetInput = rightDoc.querySelector(selector);
            if (targetInput) {
              targetInput.value = e.target.value;
            }
          }
        };
        leftDoc.addEventListener('input', onInputSync, true);

        // 4. マウスホバー位置とカスタムカーソルの同期
        leftDoc.addEventListener('mousemove', (e) => {
          const x = e.clientX;
          const y = e.clientY;
          
          // 左iframe内のカーソル座標を反映
          customCursorLeft.style.display = 'block';
          customCursorLeft.style.left = `${x}px`;
          customCursorLeft.style.top = `${y}px`;

          // 右iframe内の同一相対座標にカーソルを表示 (左右幅の50%ずらす)
          customCursorRight.style.display = 'block';
          customCursorRight.style.left = `${x + window.innerWidth / 2}px`;
          customCursorRight.style.top = `${y}px`;
        }, { passive: true });

        leftDoc.addEventListener('mouseleave', () => {
          customCursorLeft.style.display = 'none';
          customCursorRight.style.display = 'none';
        });

      } catch (err) {
        console.warn("XREAL Bridge: Same-origin access blocked or failed. Sync skipped.", err);
      }
    };

    // 左画面がロードされるたびに同期リスナーを再設定＆URL同期
    iframeLeft.addEventListener('load', () => {
      try {
        const leftUrl = iframeLeft.contentWindow.location.href;
        if (iframeRight.contentWindow.location.href !== leftUrl) {
          iframeRight.contentWindow.location.replace(leftUrl);
        }
      } catch (e) {}
      
      // 同期ロジックの適用
      setTimeout(syncIframeActions, 500);
    });

  } else {
    // 解除処理
    const overlay = document.getElementById('xreal-sbs-overlay');
    if (overlay) {
      overlay.remove();
      sbsContainer = null;
      customCursorLeft = null;
      customCursorRight = null;
      console.log("XREAL SBS 2D Mirror Mode: Disabled");
    }
  }
}

// 3. ポップアップからのON/OFF命令を監視
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'toggle_sbs_2d') {
    toggleSbs2dMode(message.enabled);
    sendResponse({ status: "ok" });
  } else if (message.type === 'check_sbs_status') {
    const isEnabled = document.getElementById('xreal-sbs-overlay') !== null;
    sendResponse({ enabled: isEnabled });
  }
  return true;
});
