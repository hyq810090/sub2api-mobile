# Android 安装包下载

新版 **1.1.0**：支持账号限额查询、Claude / OpenAI 重置卡查询与使用、用户订阅额度重置与延期、API Key 额度、余额和状态管理。手机导航精简为概览、用户、账号、服务器。

[直接下载 sub2api-mobile-1.1.0.apk](https://github.com/hyq810090/sub2api-mobile/raw/refs/heads/apk-download/downloads/sub2api-mobile-1.1.0.apk)

- Android 7.0 或更新，支持 ARM64 / ARMv7，约 62.9 MiB。
- 独立 Release 安装包，无需开发服务器。输入你的 Sub2API 地址及 Admin Key 即可连接；具体功能取决于后台版本和账号资格。
- 与之前 1.0.0 使用相同测试签名，可以覆盖升级；正式发行需要自己的发行签名。
- 类型检查、22 项模拟接口契约、手机宽度浏览器操作检查、APK 签名及结构检查已通过。未连接真实后台或进行手机实机验证。
- 源码：[mobile-management](https://github.com/hyq810090/sub2api-mobile/tree/mobile-management)，对应提交 `c33583d6b2e86d9f0e42999a919eabcddc8991f1`。本下载分支也包含新版源码。
- [功能及后台要求](../docs/MOBILE_MANAGEMENT.md)

手机浏览器打开上面的下载链接；如先看到文件页面，点 **Download raw file**。安装时按手机提示允许当前浏览器安装应用。

SHA-256：

```text
4cbccf56350ceabcc4c2cf6c72c8909fc3100209913ebb55f6262e18dcafab5b  sub2api-mobile-1.1.0.apk
```

旧版仍保留：[sub2api-mobile-1.0.0.apk](sub2api-mobile-1.0.0.apk)。
