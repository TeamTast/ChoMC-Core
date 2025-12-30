# ChoMC-Core

ChoMC Launcherのコアメカニズムを含むライブラリ
https://github.com/dscalzi/helios-core からフォーク

### 要件

* Node.js 20 (最小)

chomc-core は常に ChoMC Launcher と同じ最小ノードバージョンを利用します。

## 認証

### サポートされている認証プロバイダー

* Mojang
* Microsoft

### プロバイダー情報

#### Mojang

Mojang認証はYggdrasilスキームを使用します。https://wiki.vg/Authentication を参照してください。

#### Microsoft

Microsoft認証はAzureでOAuth 2.0を使用します。https://wiki.vg/Microsoft_Authentication_Scheme を参照してください。

### ライセンス

LGPL-3.0