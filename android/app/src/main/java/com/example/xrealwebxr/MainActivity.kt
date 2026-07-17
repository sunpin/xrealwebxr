package com.example.xrealwebxr

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity(), SensorEventListener {

    private lateinit var webView: WebView
    private lateinit var sensorManager: SensorManager
    private var rotationVectorSensor: Sensor? = null

    // 接続先のURL (PCで起動したブリッジサーバーのIPアドレス、またはエミュレータからPCへの通信用IP)
    // 実機でデバッグする場合は、PCと同じWi-Fiに繋ぎ、PCのプライベートIP (例: "http://192.168.1.100:8080") に書き換えてください。
    private val TARGET_URL = "http://10.0.2.2:8080" 

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // レイアウトXMLを使わず、プログラムから画面いっぱいにWebViewを作成
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.databaseEnabled = true
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
        }
        setContentView(webView)

        // JavaScript側からネイティブ機能を呼び出せるようにブリッジを登録
        webView.addJavascriptInterface(XrealBridge(), "AndroidXrealBridge")

        // センサーのセットアップ (Xrealグラス非接続時やエミュレータ動作時の3DoFフォールバック用)
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        rotationVectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

        // WebXRダッシュボードの読み込み
        webView.loadUrl(TARGET_URL)
    }

    override fun onResume() {
        super.onResume()
        // センサーの待受開始 (高頻度モードでジャイロ変化を取得)
        rotationVectorSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    override fun onPause() {
        super.onPause()
        // バッテリー節約のためセンサー停止
        sensorManager.unregisterListener(this)
    }

    // センサーデータの受信処理 (端末を動かすと発火)
    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type == Sensor.TYPE_ROTATION_VECTOR) {
            // 回転ベクトル（四元数 / クォータニオン）の取得
            val q = FloatArray(4)
            SensorManager.getQuaternionFromVector(q, event.values)
            
            // q[0] = w, q[1] = x, q[2] = y, q[3] = z
            val qw = q[0]
            val qx = q[1]
            val qy = q[2]
            val qz = q[3]

            // 6DoF姿勢データのJSONを構築
            // Xreal EyeなどのSLAM位置データを取得する場合は、ここの position x, y, z に
            // NRSDK の NRFrame.HeadPose.position の値を代入してください。
            // 例:
            // val posX = NRFrame.HeadPose.position.x
            // val posY = NRFrame.HeadPose.position.y
            // val posZ = NRFrame.HeadPose.position.z
            val posX = 0.0f
            val posY = 1.6f // 標準的な目の高さ (1.6m)
            val posZ = 0.0f

            val poseJson = """
                {
                    "position": { "x": $posX, "y": $posY, "z": $posZ },
                    "orientation": { "x": $qx, "y": $qy, "z": $qz, "w": $qw }
                }
            """.trimIndent()

            // WebView内のポリフィルへ姿勢情報をインジェクション
            webView.post {
                webView.evaluateJavascript(
                    "if (window.updateXrealPose) { window.updateXrealPose($poseJson); }",
                    null
                )
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // 必要に応じて処理を追加
    }

    // JavaScriptから呼び出し可能なネイティブブリッジクラス
    inner class XrealBridge {
        @JavascriptInterface
        fun getDeviceName(): String {
            return "XREAL One (via Android Bridge)"
        }

        @JavascriptInterface
        fun calibrateOrigin() {
            // キャリブレーションのトリガーを受けた場合のネイティブ処理
            // (例: 姿勢センサーの原点をリセットする)
        }
    }
}
