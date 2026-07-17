# XREAL WebXR 6DoF Bridge System

XREALグラス（XREAL One + XREAL Eyeアクセサリーなど）で6DoF（6軸）WebXR体験を実現するための開発ブリッジシステムです。

標準のブラウザやAndroid WebViewでは認識できないXREALの空間トラッキングデータを、ローカルブリッジ（WebSockets）およびAndroidネイティブブリッジ経由でWebXR API（ポリフィル）に流し込み、立体視（Side-by-Side）レンダリングを行います。

---

## システム構成図

```
[ XREAL Glasses / Eye ] 
       │
       ├─► (USB-C) ──► [ PC (Nebula / SteamVR) ] ──► server.js (WebSocket) ──► Chrome (WebXR Polyfill)
       │
       └─► (USB-C) ──► [ Android App (MainActivity.kt) ] ──► WebView (JavascriptInterface Bridge)
```

---

## クイックスタート (PC環境)

### 1. 依存関係のインストール
プロジェクトのルートディレクトリで以下を実行して、サーバーに必要なモジュールをインストールします。

```bash
npm install
```

### 2. ブリッジサーバーの起動
ローカルでWebサーバー兼WebSocketサーバーを立ち上げます。

```bash
npm start
```

起動後、コンソールに以下の案内が表示されます：
*   **ダッシュボードURL**: `http://localhost:8080`

### 3. ブラウザでの確認
1.  Google ChromeまたはEdgeで `http://localhost:8080` を開きます。
2.  画面上のコントロールパネルで「**内蔵シミュレーター**」がアクティブになっていることを確認します。3D空間内のグリッドやキューブが滑らかに動き始めます。
3.  「**ENTER WEBXR**」をクリックすると、画面が左右二分割の **Side-by-Side (SBS) 立体視モード** になり、マウスドラッグやキーボードで視点をコントロールできます。
4.  XREALグラスをPCに接続し、グラスの輝度ボタン（または音量ボタン）を **2秒間長押し** してグラスを **3D表示モード（3840x1080）** に切り替えます。
5.  ブラウザ画面をF11キーなどでフルスクリーン表示にすると、グラス内で綺麗な3D立体空間が広がります。

---

## 📱 Androidアプリのビルド ＆ 実行手順

スマートフォン単体（またはXREAL Beam Proなど）で実行するためのAndroid Studioテンプレートプロジェクトが `android/` ディレクトリに用意されています。

### 1. 接続先IPアドレスの指定
`android/app/src/main/java/com/example/xrealwebxr/MainActivity.kt` を開き、以下の変数をPCのローカルIPアドレスに書き換えます（実機デバッグする場合）。

```kotlin
// 例: PCのプライベートIPアドレスが 192.168.1.100 の場合
private val TARGET_URL = "http://192.168.1.100:8080"
```
*(Androidエミュレータを使用する場合は、デフォルトの `"http://10.0.2.2:8080"` のままでPCのローカルホストに繋がります。)*

### 2. Android Studioでインポート
1.  **Android Studio** を起動します。
2.  「**Open**」を選択し、本リポジトリ内の `android/` ディレクトリを選択してインポートします。
3.  Gradleの同期（Sync）が完了するまで待ちます。

### 3. XREAL SDK (NRSDK) の組み込み（実機6DoF連携）
本テンプレートは標準のスマートフォン内蔵ジャイロセンサー（3DoF）で動作するように実装されています。XREAL Eye等を利用して本格的な6DoF SLAMトラッキングを行う場合は以下の手順を行います。

1.  [XREAL Developer Portal](https://developer.xreal.com/) から最新の **NRSDK for Android (AAR形式)** をダウンロードします。
2.  `android/app/libs/` ディレクトリを作成し、ダウンロードした `nrsdk-release.aar` を配置します。
3.  `android/app/build.gradle` の依存関係（dependencies）の以下のコメントアウトを解除します：
    ```gradle
    implementation files('libs/nrsdk-release.aar')
    ```
4.  `MainActivity.kt` の `onSensorChanged` 内のセンサー読み取り部を、NRSDKの `NRFrame.HeadPose` から位置と回転を取得するコードに書き換えます（コード内にコメントで手順を記載しています）。

### 4. 実行
実機Android端末を開発者モードにしてUSBデバッグを有効化し、ビルドしてインストールします。グラスをスマートフォンに繋ぎ、アプリを起動すると、端末の傾きや位置移動に応じてWebXR空間がリアルタイムにトラッキングされます。

---

## 主な機能とカスタマイズ

*   **IPD（瞳孔間距離）の調整**: ダッシュボードの入力欄でIPD（ミリ単位）を変更すると、左右の視差行列が動的に再計算され、最適な立体感が得られます。
*   **キャリブレーション**: 「原点キャリブレーション」ボタンを押すことで、現在の視界を正面（基準位置）に設定し直すことができます。

---

## 📚 参考にしたリポジトリ・ドキュメント

本システムのパケット構造解析、ジャイロ・加速度の軸の特定、および 3D/SBS ディスプレイ制御にあたり、以下のオープンソースコミュニティのリバースエンジニアリング成果を参考にしました。

*   **[SamiMitwalli/One-Pro-IMU-Retriever-Demo](https://github.com/SamiMitwalli/One-Pro-IMU-Retriever-Demo)**: Xreal One / One Pro の TCP ポート `52998` を介した IMU データの取得仕様、および起動直後の NaN パケットのフィルタリング対策。
*   **[badicsalex/ar-drivers-rs](https://github.com/badicsalex/ar-drivers-rs)**: Xreal Air / One シリーズの USB HID 通信、および 3D SBS モード切り替え MCU コマンド仕様（cmd_id: `0x08`, data: `3`/`9` 等）。
*   **[8796n/obs-nyan-real-3dof](https://github.com/8796n/obs-nyan-real-3dof)**: 各種 AR グラスの HID デバイス認識および 3DoF 統合処理におけるデバイスレジストリ（C++）の構成。
*   **[XREAL Community GitHub](https://github.com/xreal-community)**: XREAL 公式の Android/Unity 用 SDK（NRSDK）およびボタン・解像度仕様。
