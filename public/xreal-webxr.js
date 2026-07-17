/**
 * Xreal WebXR 6DoF Polyfill Library
 * PC (WebSocket) & Android (Native Bridge) 対応
 * [修正版]: 生パケット中継イベントの発行と姿勢情報のサーバーへの同期に対応
 */
(function() {
  console.log("Xreal WebXR Polyfill (Raw Packet Relay) Initializing...");

  const CONFIG = {
    ipd: 0.063,
    fovHorizontal: 38,
    near: 0.1,
    far: 1000.0,
    wsUrl: `ws://${window.location.hostname || 'localhost'}:8080`
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

  // 1. Androidネイティブブリッジからのデータ受信インターフェース
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

  // 2. PC向け：WebSocketクライアントの設定
  function connectWebSocket() {
    if (window.AndroidXrealBridge) {
      console.log("Android Native Bridge detected. WebSocket client skipped.");
      trackingSource = 'android-native';
      return;
    }

    console.log(`Connecting to pose server at ${CONFIG.wsUrl}...`);
    wsSocket = new WebSocket(CONFIG.wsUrl);

    wsSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'pose') {
          // Xreal実機(3DoF)トラッキング中は、位置(y=1.6)のみ同期し、回転はブラウザ側のバイナリ解析結果を優先
          if (message.source === 'xreal-imu') {
            currentPose.position = message.pose.position;
          } else {
            currentPose = message.pose;
          }
          trackingSource = message.source;
          
          window.dispatchEvent(new CustomEvent('xreal-pose-update', { detail: { pose: currentPose, source: trackingSource } }));
        } else if (message.type === 'raw_packet') {
          // サーバーから中継されたグラスの生のバイナリデータを受信し、ブラウザUIに中継
          window.dispatchEvent(new CustomEvent('xreal-raw-packet', { 
            detail: { length: message.length, bytes: message.bytes } 
          }));
        }
      } catch (e) {
        console.error("Error parsing WebSocket message:", e);
      }
    };

    wsSocket.onclose = () => {
      console.log("WebSocket disconnected. Retrying in 3 seconds...");
      trackingSource = 'disconnected';
      wsSocket = null;
      setTimeout(connectWebSocket, 3000);
    };

    wsSocket.onerror = () => {
      trackingSource = 'error';
    };
  }

  // 起動時にWebSocket接続を開始
  connectWebSocket();

  // 行列計算用のヘルパー
  const MatrixUtils = {
    fromRotationTranslation: (q, v) => {
      const x = q.x, y = q.y, z = q.z, w = q.w;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;

      return new Float32Array([
        1 - (yy + zz), xy + wz, xz - wy, 0,
        xy - wz, 1 - (xx + zz), yz + wx, 0,
        xz + wy, yz - wx, 1 - (xx + yy), 0,
        v.x, v.y, v.z, 1
      ]);
    },

    perspective: (fovDeg, aspect, near, far) => {
      const f = 1.0 / Math.tan((fovDeg * Math.PI) / 360.0);
      const nf = 1.0 / (near - far);
      return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0
      ]);
    },

    translate: (mat, x, y, z) => {
      const out = new Float32Array(mat);
      out[12] += mat[0] * x + mat[4] * y + mat[8] * z;
      out[13] += mat[1] * x + mat[5] * y + mat[9] * z;
      out[14] += mat[2] * x + mat[6] * y + mat[10] * z;
      out[15] += mat[3] * x + mat[7] * y + mat[11] * z;
      return out;
    },

    invert: (a) => {
      const out = new Float32Array(16);
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

      const b00 = a00 * a11 - a01 * a10;
      const b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11;
      const b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30;
      const b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31;
      const b11 = a22 * a33 - a23 * a32;

      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

      if (!det) return null;
      det = 1.0 / det;

      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

      return out;
    }
  };

  // 3. WebXR APIクラス群のポリフィル実装
  class MockXRSystem extends EventTarget {
    constructor() {
      super();
    }

    async isSessionSupported(mode) {
      return mode === 'immersive-vr' || mode === 'immersive-ar';
    }

    async requestSession(mode, options) {
      if (mode !== 'immersive-vr' && mode !== 'immersive-ar') {
        throw new DOMException("Session mode not supported", "NotSupportedError");
      }
      console.log(`Xreal WebXR Polyfill: Starting session [${mode}]`);
      this.activeSession = new MockXRSession(mode, options);
      return this.activeSession;
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

      // 描画ループ起動
      this.loopId = requestAnimationFrame((t) => this._onFrame(t));
    }

    get renderState() { return this._renderState; }

    updateRenderState(newState) {
      this._renderState = Object.assign(this._renderState, newState);
      if (newState.baseLayer && newState.baseLayer.context) {
        const canvas = newState.baseLayer.context.canvas;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
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
      
      const event = new Event('end');
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
      const rawMatrix = MatrixUtils.fromRotationTranslation(
        currentPose.orientation,
        currentPose.position
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
    }

    getViewport(view) {
      return new MockXRViewport(view.viewport);
    }
  };

  if (typeof window.XRRigidTransform === 'undefined') {
    window.XRRigidTransform = MockXRRigidTransform;
  }

  const polyfillInstance = new MockXRSystem();

  Object.defineProperty(navigator, 'xr', {
    value: polyfillInstance,
    writable: true,
    configurable: true
  });

  window.XrealWebXR = {
    setIPD: (ipd) => {
      CONFIG.ipd = ipd;
      console.log(`IPD updated to ${ipd} m`);
    },
    getPose: () => currentPose,
    getTrackingSource: () => trackingSource,
    send: (data) => {
      if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
        wsSocket.send(JSON.stringify(data));
        return true;
      }
      return false;
    },
    updateOrientation: (q) => {
      currentPose.orientation = q;
      // 実機トラッキング中のみ、算出したクォータニオンをサーバー側へ逆同期する
      if (wsSocket && wsSocket.readyState === WebSocket.OPEN && trackingSource === 'xreal-imu') {
        wsSocket.send(JSON.stringify({
          type: 'update_orientation',
          orientation: q
        }));
      }
    }
  };

  console.log("Xreal WebXR Polyfill (Fixed Relay Version) registered successfully!");
})();
