# CrossWindowCom 跨窗口通信插件开发手册

---

## 目录
1. [简介](#简介)  
2. [浏览器兼容性](#浏览器兼容性)  
3. [安装与引入](#安装与引入)  
4. [配置选项](#配置选项)  
5. [基础用法](#基础用法)  
6. [事件系统](#事件系统)  
7. [请求系统](#请求系统)  
8. [高级功能](#高级功能)  
9. [错误处理](#错误处理)  
10. [完整示例](#完整示例)  

---

<a id="简介"></a>
## 1. 简介  
CrossWindowCom 是一个安全、灵活的跨窗口/跨域通信解决方案，支持以下特性：  
- **双向通信**：事件广播与请求/响应模式  
- **安全验证**：严格的 Origin 校验与消息格式验证  
- **心跳检测**：实时监测连接状态  
- **命名空间隔离**：多频道消息互不干扰  
- **全浏览器支持**：兼容 IE8+ 及所有现代浏览器  

---

<a id="浏览器兼容性"></a>
## 2. 浏览器兼容性  

### 支持矩阵
| 浏览器              | 最低版本 | 支持级别          | 注意事项                                  |
|---------------------|----------|-------------------|------------------------------------------|
| **Chrome**          | 1+       | ✔️ 完全支持       | 桌面/Android 全兼容                      |
| **Firefox**         | 3+       | ✔️ 完全支持       | 移动版全支持                             |
| **Safari**          | 4+       | ✔️ 完全支持       | iOS 5+ 可用                              |
| **Edge**            | 12+      | ✔️ 完全支持       | 新旧版本均兼容                           |
| **Opera**           | 9.5+     | ✔️ 完全支持       | Chromium 内核版本表现最佳                |
| **IE**              | 8+       | ⚠️ 部分支持       | 需 JSON 序列化处理（见下文）            |
| **Android Browser** | 2.3+     | ✔️ 完全支持       | 老旧设备需性能优化                      |
| **iOS Safari**      | 5.0+     | ✔️ 完全支持       | 需 iOS 5+                               |

### 关键注意事项
#### 2.1 IE 兼容方案
```javascript
// 手动序列化消息 (IE8/9)
if (window.postMessage.length === 1) {
  const originalPostMessage = window.postMessage;
  window.postMessage = function(message, targetOrigin) {
    originalPostMessage(JSON.stringify(message), targetOrigin);
  };
}

// 接收处理
messenger.onEvent('legacy-message', (rawData) => {
  try {
    const data = JSON.parse(rawData);
    // 处理数据...
  } catch(e) { /* 错误处理 */ }
});
```

#### 2.2 移动端优化
```html
<!-- 添加视口标签 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```
```javascript
// 高频事件节流
messenger.onEvent('scroll', throttle(handleScroll, 100));

function throttle(fn, delay) {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall < delay) return;
    lastCall = now;
    return fn(...args);
  }
}
```

#### 2.3 跨协议限制处理
```javascript
const targetOrigin = window.location.protocol === 'file:' 
  ? '*' // 本地文件协议特殊处理
  : window.location.origin;
```

---

<a id="安装与引入"></a>
## 3. 安装与引入

### 浏览器环境
```html
<script src="path/to/CrossWindowCom.js"></script>
<script>
  const messenger = new CrossWindowCom({ 
    debug: true,
    targetOrigin: 'https://your-domain.com'
  });
</script>
```

---

<a id="配置选项"></a>
## 4. 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `targetOrigin` | string | `window.location.origin` | 目标窗口的 Origin |
| `verifyOrigin` | boolean | `true` | 是否验证消息来源 |
| `namespace` | string | `'default'` | 通信命名空间 |
| `debug` | boolean | `false` | 启用调试日志 |
| `messageTimeout` | number | `5000` | 请求超时时间(ms) |
| `errorHandler` | Function | 默认处理器 | 全局错误回调 |

---

<a id="基础用法"></a>
## 5. 基础用法

### 添加/移除目标窗口
```javascript
// 添加 iframe 窗口
const iframe = document.getElementById('my-frame');
messenger.addTargetWindow(iframe.contentWindow);

// 移除弹出窗口
const popup = window.open('...');
messenger.removeTargetWindow(popup);
```

### 销毁实例
```javascript
// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  messenger.destroy();
});
```

---

<a id="事件系统"></a>
## 6. 事件系统

### 事件监听
```javascript
// 永久监听
messenger.onEvent('user-login', (userData) => {
  console.log('用户登录:', userData);
});

// 一次性监听
messenger.onceRequest('payment', (data) => {
  console.log('支付完成:', data);
});
```

### 发送事件
```javascript
messenger.emitEvent('page-view', { 
  path: '/product', 
  duration: 120 
});
```

---

<a id="请求系统"></a>
## 7. 请求系统

### 注册处理器
```javascript
messenger.onRequest('get-user', async (params) => {
  const user = await fetchUser(params.id);
  return { status: 'success', user };
});
```

### 发送请求
```javascript
messenger.request('get-data', { id: 123 })
  .then(response => console.log(response))
  .catch(error => console.error('请求失败:', error));
```

---

<a id="高级功能"></a>
## 8. 高级功能

### 心跳检测
```javascript
// 每10秒发送心跳
messenger.startHeartbeat(10000);

// 停止检测
messenger.stopHeartbeat();
```

### 命名空间隔离
```javascript
const authChannel = new CrossWindowCom({ namespace: 'auth' });
const chatChannel = new CrossWindowCom({ namespace: 'chat' });
```

---

<a id="错误处理"></a>
## 9. 错误处理

### 自定义错误处理器
```javascript
new CrossWindowCom({
  errorHandler: (error) => {
    console.error('[通信错误]', error);
    sendToLogService(error);
  }
});
```

### 请求错误分类
```javascript
messenger.request('api')
  .catch(error => {
    if (error.message.includes('timeout')) {
      showToast('请求超时，请重试');
    }
  });
```

---

<a id="完整示例"></a>
## 10. 完整示例

### 主页面
```html
<iframe id="child" src="child.html"></iframe>

<script>
  const messenger = new CrossWindowCom({
    debug: true,
    namespace: 'main'
  });

  // 添加子窗口
  const iframe = document.getElementById('child');
  messenger.addTargetWindow(iframe.contentWindow);

  // 监听子窗口事件
  messenger.onEvent('child-ready', () => {
    messenger.emitEvent('config', { theme: 'dark' });
  });
</script>
```

### 子页面
```javascript
const childMessenger = new CrossWindowCom({
  namespace: 'main',
  targetOrigin: parent.location.origin
});

// 通知父窗口
childMessenger.emitEvent('child-ready');

// 处理父窗口请求
childMessenger.onRequest('process', (data) => {
  return heavyProcessing(data);
});
```

---
