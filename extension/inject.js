/**
 * Xreal WebXR 6DoF Polyfill Library (Chrome Extension Injection Version)
 */
(function() {
  try {
    console.log("Xreal WebXR Polyfill (Extension Version) Initializing...");

  const CONFIG = {
    ipd: 0.063,
    fovHorizontal: 38,
    near: 0.1,
    far: 1000.0,
    wsUrl: "ws://localhost:8080" // 拡張機能経由での注入のため常にローカルホストに接続
  };

  let currentPose = {
    position: { x: 0, y: 1.6, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 }
  };

  let trackingSource = 'none';
  let wsSocket = null;

  const mockMakeXRCompatible = function() {
    return Promise.resolve();
  };

  if (typeof WebGLRenderingContext !== 'undefined') {
    WebGLRenderingContext.prototype.makeXRCompatible = mockMakeXRCompatible;
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    WebGL2RenderingContext.prototype.makeXRCompatible = mockMakeXRCompatible;
  }

  // 1. Androidネイティブブリッジからのデータ受信インターフェース (後方互換性)
  window.updateXrealPose = function(poseData) {
    try {
      const data = typeof poseData === 'string' ? JSON.parse(poseData) : poseData;
      if (data.position) currentPose.position = data.position;
      if (data.orientation) currentPose.orientation = data.orientation;
      trackingSource = 'android-native';
      window.dispatchEvent(new CustomEvent('xreal-pose-update', { detail: { pose: currentPose, source: trackingSource } }));
    } catch (e) {
      console.error("Failed to parse native pose data:", e);
    }
  };

  // 2. 拡張機能の content.js からリレーされてきた姿勢メッセージを処理するリスナー
  let poseRecvCount = 0;
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'XREAL_INJECT_POSE') {
      currentPose = event.data.pose;
      trackingSource = event.data.source;
      
      poseRecvCount++;
      if (poseRecvCount % 100 === 0) {
        console.log(`[Polyfill RECV] Pose received in page: w=${currentPose.orientation.w.toFixed(4)}, x=${currentPose.orientation.x.toFixed(4)}, y=${currentPose.orientation.y.toFixed(4)}, z=${currentPose.orientation.z.toFixed(4)}`);
      }
      
      // 姿勢更新イベントの発行
      window.dispatchEvent(new CustomEvent('xreal-pose-update', {
        detail: { pose: currentPose, source: trackingSource }
      }));
    }
  });

  // 3. WebGL / WebXR 各種モック実装
  const MatrixUtils = {
    translate: (m, x, y, z) => {
      const out = new Float32Array(m);
      out[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
      out[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
      return out;
    },
    fromRotationTranslation: (q, v) => {
      const out = new Float32Array(16);
      const x = q.x, y = q.y, z = q.z, w = q.w;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;

      out[0] = 1 - (yy + zz);
      out[1] = xy + wz;
      out[2] = xz - wy;
      out[3] = 0;
      out[4] = xy - wz;
      out[5] = 1 - (xx + zz);
      out[6] = yz + wx;
      out[7] = 0;
      out[8] = xz + wy;
      out[9] = yz - wx;
      out[10] = 1 - (xx + yy);
      out[11] = 0;
      out[12] = v.x;
      out[13] = v.y;
      out[14] = v.z;
      out[15] = 1;
      return out;
    },
    perspective: (fovDegrees, aspect, near, far) => {
      const out = new Float32Array(16);
      const f = 1.0 / Math.tan((fovDegrees * Math.PI) / 360.0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) / (near - far);
      out[11] = -1;
      out[14] = (2 * far * near) / (near - far);
      out[15] = 0;
      return out;
    },
    invert: (m) => {
      const out = new Float32Array(16);
      // 回転行列部分（左上 3x3）を転置
      out[0] = m[0];  out[1] = m[4];  out[2] = m[8];  out[3] = 0;
      out[4] = m[1];  out[5] = m[5];  out[6] = m[9];  out[7] = 0;
      out[8] = m[2];  out[9] = m[6];  out[10] = m[10]; out[11] = 0;

      // 平行移動成分の逆計算 (-R^T * T)
      const tx = m[12], ty = m[13], tz = m[14];
      out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
      out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
      out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
      out[15] = 1;
      return out;
    }
  };

  class MockXRSystem extends EventTarget {
    constructor() {
      super();
    }
    isSessionSupported(mode) {
      if (mode === 'immersive-vr' || mode === 'inline') {
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
    requestSession(mode, options) {
      if (mode !== 'immersive-vr' && mode !== 'inline') {
        return Promise.reject(new Error("Unsupported session mode: " + mode));
      }
      const session = new MockXRSession(mode, options);
      return Promise.resolve(session);
    }
  }

  class MockXRSession extends EventTarget {
    constructor(mode, options) {
      super();
      this.mode = mode;
      this.options = options;
      this.ended = false;
      this.animationFrameCallbacks = [];
      this.callbackIdAccumulator = 0;
      this.inputSources = [];
      
      this._renderState = {
        baseLayer: null,
        depthNear: CONFIG.near,
        depthFar: CONFIG.far,
        inlineVerticalFieldOfView: 90
      };

      // フルスクリーン解除のイベントを検知してセッションも終了させる
      this.onFullscreenChange = () => {
        if (!document.fullscreenElement && !this.ended) {
          console.log("Xreal Polyfill: Fullscreen exited by user. Ending XR session.");
          this.end();
        }
      };
      if (this.mode === 'immersive-vr') {
        document.addEventListener('fullscreenchange', this.onFullscreenChange);
      }

      this.loopId = requestAnimationFrame((t) => this._onFrame(t));
    }

    get renderState() { return this._renderState; }

    updateRenderState(newState) {
      this._renderState = Object.assign(this._renderState, newState);
      if (newState.baseLayer && newState.baseLayer.context) {
        const canvas = newState.baseLayer.context.canvas;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
        // immersive-vr の開始時にキャンバス要素の物理解像度を画面サイズに同期し、自動的にフルスクリーン化する
        if (this.mode === 'immersive-vr') {
          canvas.width = window.screen.width || 3840;
          canvas.height = window.screen.height || 1080;
          
          try {
            if (!document.fullscreenElement) {
              if (canvas.requestFullscreen) {
                canvas.requestFullscreen().catch(e => console.warn("Fullscreen failed:", e));
              } else if (canvas.webkitRequestFullscreen) {
                canvas.webkitRequestFullscreen().catch(e => console.warn("Fullscreen failed:", e));
              }
            }
          } catch (err) {
            console.warn("Could not request fullscreen on WebGL canvas:", err);
          }
        }
      }
    }

    requestAnimationFrame(callback) {
      const id = ++this.callbackIdAccumulator;
      this.animationFrameCallbacks.push({ id, callback });
      return id;
    }

    cancelAnimationFrame(id) {
      this.animationFrameCallbacks = this.animationFrameCallbacks.filter(c => c.id !== id);
    }

    async requestReferenceSpace(type) {
      return new MockXRReferenceSpace(type);
    }

    async end() {
      if (this.ended) return;
      this.ended = true;
      cancelAnimationFrame(this.loopId);
      console.log("Xreal WebXR Polyfill: Session ended.");
      
      if (this.mode === 'immersive-vr') {
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        
        // フルスクリーンを抜ける
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(err => console.warn(err));
        }
      }
      
      const event = new Event('end');
      event.session = this; // WebXR規格に従い、セッションインスタンスへの参照を割り当て
      this.dispatchEvent(event);
      if (this.onend) this.onend(event);
    }

    _onFrame(time) {
      if (this.ended) return;

      const callbacks = this.animationFrameCallbacks;
      this.animationFrameCallbacks = [];

      const frame = new MockXRFrame(this);

      for (const item of callbacks) {
        try {
          item.callback(time, frame);
        } catch (e) {
          console.error("Error in WebXR animation frame callback:", e);
        }
      }

      this.loopId = requestAnimationFrame((t) => this._onFrame(t));
    }
  }

  class MockXRReferenceSpace extends EventTarget {
    constructor(type) {
      super();
      this.type = type;
    }
    getOffsetReferenceSpace(originTransform) {
      return this;
    }
  }

  class MockXRFrame {
    constructor(session) {
      this.session = session;
    }

    getViewerPose(referenceSpace) {
      // 基準空間（referenceSpace）が local-floor の場合のみ床面高さ1.6mを自動で持ち上げる
      const position = {
        x: currentPose.position.x,
        y: currentPose.position.y,
        z: currentPose.position.z
      };
      
      if (referenceSpace && referenceSpace.type === 'local-floor') {
        position.y += 1.6;
      }

      const rawMatrix = MatrixUtils.fromRotationTranslation(
        currentPose.orientation,
        position
      );
      return new MockXRViewerPose(rawMatrix, this.session);
    }
  }

  class MockXRViewerPose {
    constructor(transformMatrix, session) {
      this.transform = new MockXRRigidTransform(transformMatrix);
      
      const canvas = session.renderState.baseLayer 
        ? (session.renderState.baseLayer.context ? session.renderState.baseLayer.context.canvas : session.renderState.baseLayer.canvas)
        : { width: 1920, height: 1080 };
      
      const w = canvas.width || 1920;
      const h = canvas.height || 1080;

      if (session.mode === 'inline') {
        // インライン(通常2D画面)モードでは、画面分割せず単一視野でレンダリング
        const aspect = w / h;
        const projMatrix = MatrixUtils.perspective(CONFIG.fovHorizontal, aspect, CONFIG.near, CONFIG.far);
        this.views = [
          new MockXRView('none', transformMatrix, projMatrix, { x: 0, y: 0, width: w, height: h })
        ];
      } else {
        // VRモードでは、Side-by-Side (左右分割立体視) レンダリング
        const aspect = (w / 2) / h;
        const projMatrix = MatrixUtils.perspective(CONFIG.fovHorizontal, aspect, CONFIG.near, CONFIG.far);

        const leftEyeMatrix = MatrixUtils.translate(transformMatrix, -CONFIG.ipd / 2, 0, 0);
        const rightEyeMatrix = MatrixUtils.translate(transformMatrix, CONFIG.ipd / 2, 0, 0);

        this.views = [
          new MockXRView('left', leftEyeMatrix, projMatrix, { x: 0, y: 0, width: w / 2, height: h }),
          new MockXRView('right', rightEyeMatrix, projMatrix, { x: w / 2, y: 0, width: w / 2, height: h })
        ];
      }
    }
  }

  class MockXRView {
    constructor(eye, transformMatrix, projectionMatrix, viewportRect) {
      this.eye = eye;
      this.transform = new MockXRRigidTransform(transformMatrix);
      this.projectionMatrix = projectionMatrix;
      this.viewport = viewportRect;
    }
  }

  class MockXRRigidTransform {
    constructor(matrix) {
      this.matrix = matrix;
      this.position = { x: matrix[12], y: matrix[13], z: matrix[14], w: 1.0 };
      this.orientation = currentPose.orientation;
    }
    get inverse() {
      return new MockXRRigidTransform(MatrixUtils.invert(this.matrix));
    }
  }

  class MockXRViewport {
    constructor(rect) {
      this.x = rect.x;
      this.y = rect.y;
      this.width = rect.width;
      this.height = rect.height;
    }
  }

  window.XRWebGLLayer = class XRWebGLLayer {
    constructor(session, context, options) {
      this.session = session;
      this.context = context;
      this.antialias = options ? !!options.antialias : true;
      this.depth = options ? !!options.depth : true;
      this.stencil = options ? !!options.stencil : false;
      this.alpha = options ? !!options.alpha : true;
      this.canvas = context.canvas;
      this.framebuffer = null;
      this.framebufferWidth = context.canvas.width || 1920;
      this.framebufferHeight = context.canvas.height || 1080;
      this.ignoreDepthValues = false;
    }

    static getViewportScale(session) {
      return 1.0;
    }

    getViewport(view) {
      return new MockXRViewport(view.viewport);
    }
  };

  if (typeof window.XRRigidTransform === 'undefined') {
    window.XRRigidTransform = MockXRRigidTransform;
  }

  // WebXR標準仕様のクラス（コンストラクタ）をグローバル空間にマッピング
  window.XRSystem = MockXRSystem;
  window.XRSession = MockXRSession;
  window.XRFrame = MockXRFrame;
  window.XRView = MockXRView;
  window.XRViewport = MockXRViewport;
  window.XRViewerPose = MockXRViewerPose;
  window.XRReferenceSpace = MockXRReferenceSpace;

  const polyfillInstance = new MockXRSystem();

    // navigator.xr の安全な上書き登録 (TypeError回避用のフォールバック付)
    try {
      Object.defineProperty(navigator, 'xr', {
        value: polyfillInstance,
        writable: true,
        configurable: true
      });
    } catch (err) {
      console.warn("Xreal WebXR: Cannot redefine navigator.xr directly. Trying prototype injection...", err);
      try {
        Object.defineProperty(Navigator.prototype, 'xr', {
          get: () => polyfillInstance,
          configurable: true
        });
      } catch (errProto) {
        console.error("Xreal WebXR: Critical error, failed to define navigator.xr on prototype:", errProto);
      }
    }

    window.XrealWebXR = {
      setIPD: (ipd) => {
        CONFIG.ipd = ipd / 1000.0;
        console.log(`IPD updated to ${ipd} mm`);
      },
      getPose: () => currentPose,
      getTrackingSource: () => trackingSource,
      send: (data) => {
        // メインワールドから孤立ワールド(content.js)へポストメッセージで中継転送
        window.postMessage({ type: 'XREAL_FORWARD_TO_SERVER', data: data }, '*');
        return true;
      }
    };

    // 4. ポップアップやコンテンツスクリプトからのキャリブレーション要求（postMessage）を検知して同期送信
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'XREAL_CALIBRATE') {
        console.log("Xreal Polyfill: Calibration request received via postMessage.");
        window.XrealWebXR.send({ type: 'calibrate' });
      }
    });

    // 5. キーボードの「R」キーまたは「F9」キーによる原点リセットショートカット
    window.addEventListener('keydown', (event) => {
      // テキスト入力中はキー入力を無視する（F9を除く）
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable
      );
      
      const isRKey = event.code === 'KeyR' && !isTyping;
      const isF9Key = event.code === 'F9';

      if (isRKey || isF9Key) {
        console.log(`Xreal Polyfill: Calibration triggered via shortcut key (${event.code})!`);
        window.XrealWebXR.send({ type: 'calibrate' });
        
        // 画面左上にSFチックなインジケータを表示して通知
        const flashIndicator = document.createElement('div');
        flashIndicator.textContent = "⚙️ CALIBRATING (STABILIZE GLASSES)...";
        flashIndicator.style.cssText = "position: fixed; top: 20px; left: 20px; padding: 10px 20px; background: rgba(0,0,0,0.85); color: #00f0ff; border-radius: 5px; font-family: sans-serif; font-size: 14px; font-weight: bold; border: 1px solid #00f0ff; z-index: 999999; pointer-events: none; box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);";
        document.body.appendChild(flashIndicator);
        setTimeout(() => {
          flashIndicator.textContent = "🟢 CALIBRATED!";
          flashIndicator.style.color = "#00ff66";
          flashIndicator.style.borderColor = "#00ff66";
          flashIndicator.style.boxShadow = "0 0 10px rgba(0, 255, 102, 0.5)";
          setTimeout(() => flashIndicator.remove(), 800);
        }, 1200);
      }
    });

    console.log("Xreal WebXR Polyfill (Chrome Extension Version) injected successfully!");
  } catch (globalErr) {
    console.error("Xreal WebXR Polyfill: Global initialization crashed:", globalErr);
  }
})();
