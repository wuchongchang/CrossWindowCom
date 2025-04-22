/**
 * CrossWindowCom - 改进版跨窗口/跨域通信插件
 * 明确区分事件和请求两种通信模式，提供更清晰的API
 *
 * @param {Object} options 配置选项
 * @param {string} [options.targetOrigin=window.location.origin] 目标窗口的origin
 * @param {boolean} [options.verifyOrigin=true] 是否验证消息来源
 * @param {string} [options.namespace='default'] 命名空间，用于区分不同通信频道
 * @param {boolean} [options.debug=false] 是否开启调试模式
 * @param {number} [options.messageTimeout=5000] 请求超时时间(毫秒)
 * @param {Function} [options.errorHandler] 全局错误处理器
 */
class CrossWindowCom {
  constructor(options = {}) {
    // 默认配置
    this.settings = {
      targetOrigin: window.location.origin,
      verifyOrigin: true,
      messageType: 'kingdee',
      namespace: 'default',
      debug: false,
      messageTimeout: 5000,
      errorHandler: (error) => console.error('[CrossWindowCom Error]', error),
      ...options
    };


    // 消息体转换器
    this.messageConverter = function (message, type) {
      if (this.settings.messageType === 'kingdee') {
        if (type === 'response') {
          var msg = message.content;
          msg.namespace = message.pageId || 'default';
          return msg;
        }
        // 金蝶平台消息体转换
        var msg = {
          pageId: message.namespace || 'default',
          type: 'invokeCustomEvent',
          content: message
        }
        return msg;
      }
      // 默认不处理直接返回
      return message;
    }
    // 处理器存储    
    this.eventHandlers = {};      // 事件处理器 {eventName: [handler1, handler2]}
    this.requestHandlers = {};    // 请求处理器 {eventName: handler}
    this.messageHandlers = {};    // 临时请求响应处理器 {messageId: handler}
    this.targetWindows = new Set(); // 目标窗口集合
    this.pendingMessages = new Map(); // 待处理消息队列 {messageId: messageData}

    // 心跳检测相关
    this.heartbeatInterval = null;
    this.heartbeatCounter = 0;

    // 初始化消息监听
    this._initListener();
  }

  /**​
   * 初始化消息监听器
   * 私有方法，外部不应直接调用
   */
  _initListener() {
    // 使用箭头函数绑定this，同时保存引用以便销毁
    this._messageListener = (event) => {
      try {
        // 安全验证：检查消息来源是否合法
        if (this.settings.verifyOrigin && event.origin !== this.settings.targetOrigin) {
          this._log(`Message from unauthorized origin: ${event.origin}`);
          return;
        }

        const data = this.messageConverter(event.data, 'response');


        // 检查消息是否属于本插件（通过namespace校验）
        if (!data || data.namespace !== this.settings.namespace) {
          return;
        }

        // 验证消息格式是否符合要求
        if (!this._validateMessage(data)) {
          this._log(`Invalid message format:`, data);
          return;
        }

        this._log(`Received message from ${event.origin}:`, data);

        // 根据消息类型路由处理
        switch (data.type) {
          case 'request':
            this._handleRequest(event, data);
            break;
          case 'response':
            this._handleResponse(data);
            break;
          case 'event':
            this._handleEvent(data);
            break;
          case 'heartbeat':
            this._handleHeartbeat(event, data);
            break;
          default:
            this._log(`Unknown message type: ${data.type}`);
        }
      } catch (error) {
        this.settings.errorHandler(error);
      }
    };

    window.addEventListener('message', this._messageListener);
  }

  /**​
   * 处理请求消息
   * @param {MessageEvent} event 原始消息事件
   * @param {Object} message 解析后的消息对象
   */
  _handleRequest(event, message) {
    const { eventName, messageId, params } = message;

    // 查找对应的请求处理器
    const handler = this.requestHandlers[eventName];
    if (handler) {
      try {
        const response = handler(params) ?? { status: 'unhandled' };
        // 处理消息体的转换（主要是金蝶平台有自己的处理逻辑在）
        let message = this.messageConverter({
          namespace: this.settings.namespace,
          type: 'response',
          messageId,
          params: response
        })
        // 发送响应
        event.source.postMessage(message, event.origin);
      } catch (error) {
        this.settings.errorHandler(error);

        // 即使出错也返回错误响应
        let message = this.messageConverter({
          namespace: this.settings.namespace,
          type: 'response',
          messageId,
          params: {
            status: 'error',
            message: error.message
          }
        })
        // 发送响应
        event.source.postMessage(message, event.origin);
      }
    } else {
      // 没有找到处理器
      this._log(`No handler found for request: ${eventName}`);
      let message = this.messageConverter({
        namespace: this.settings.namespace,
        type: 'response',
        messageId,
        params: {
          status: 'no_handler',
          eventName
        }
      })
      // 发送响应
      event.source.postMessage(message, event.origin);
    }
  }

  /**​
   * 处理响应消息
   * @param {Object} message 消息对象
   */
  _handleResponse(message) {
    const { messageId, params } = message;

    if (this.messageHandlers[messageId]) {
      const handler = this.messageHandlers[messageId];

      // 执行处理器并清理
      handler(params);
      delete this.messageHandlers[messageId];
      this.pendingMessages.delete(messageId);
    } else {
      this._log(`No handler found for response with ID: ${messageId}`);
    }
  }

  /**​
   * 处理事件消息
   * @param {Object} message 消息对象
   */
  _handleEvent(message) {
    const { eventName, params } = message;

    if (this.eventHandlers[eventName]) {
      // 执行所有注册的处理器
      this.eventHandlers[eventName].forEach(handler => {
        try {
          handler(params);
        } catch (error) {
          this.settings.errorHandler(error);
        }
      });
    } else {
      this._log(`No handlers registered for event: ${eventName}`);
    }
  }

  /**​
   * 处理心跳消息
   * @param {MessageEvent} event 原始消息事件
   * @param {Object} message 消息对象
   */
  _handleHeartbeat(event, message) {
    const { counter } = message;
    this._log(`Received heartbeat #${counter} from ${event.origin}`);

    let msg = this.messageConverter({
      namespace: this.settings.namespace,
      type: 'heartbeat-response',
      counter
    })
    // 返回心跳响应
    event.source.postMessage(msg, event.origin);
  }

  /**​
   * 验证消息格式
   * @param {Object} message 消息对象
   * @returns {boolean} 是否有效
   */
  _validateMessage(message) {
    // 基本字段检查
    if (!message || typeof message !== 'object') return false;
    if (message.namespace !== this.settings.namespace) return false;

    // 按类型验证
    switch (message.type) {
      case 'request':
        return typeof message.eventName === 'string' &&
          typeof message.messageId === 'string';
      case 'response':
        return typeof message.messageId === 'string';
      case 'event':
        return typeof message.eventName === 'string';
      case 'heartbeat':
      case 'heartbeat-response':
        return typeof message.counter === 'number';
      default:
        return false;
    }
  }

  /**​
   * 发送消息到所有目标窗口
   * @param {string} type 消息类型
   * @param {Object} params 消息参数
   */
  _sendToAll(type, params) {
    const messageId = params?.messageId ?? this._generateId();
    let message = this.messageConverter({
      namespace: this.settings.namespace,
      type,
      messageId,
      ...params
    })

    // 添加到待处理队列
    this.pendingMessages.set(messageId, {
      message,
      timestamp: Date.now(),
      retries: 0
    });

    // 尝试发送到所有目标窗口
    let successCount = 0;
    this.targetWindows.forEach(target => {
      try {
        target.postMessage(message, this.settings.targetOrigin);
        successCount++;
      } catch (error) {
        this._log(`Failed to send message to target window:`, error);
      }
    });

    // 如果全部发送失败，立即从队列中移除
    if (successCount === 0) {
      this.pendingMessages.delete(messageId);
    }

    return messageId;
  }

  /**​
   * 生成唯一ID
   * @returns {string} 唯一ID
   */
  _generateId() {
    // 优先使用crypto API
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // 回退方案
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**​
   * 调试日志
   * @param {...any} args 日志参数
   */
  _log(...args) {
    if (this.settings.debug) {
      console.log(`[CrossWindowCom][${this.settings.namespace}]`, ...args);
    }
  }

  /* ========== 公共API ========== */

  /**​
   * 添加目标窗口
   * @param {Window} targetWindow 目标窗口对象
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  addTargetWindow(targetWindow) {
    if (targetWindow && !this.targetWindows.has(targetWindow)) {
      this.targetWindows.add(targetWindow);
      this._log(`Added target window`);
    }
    return this;
  }

  /**​
   * 移除目标窗口
   * @param {Window} targetWindow 目标窗口对象
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  removeTargetWindow(targetWindow) {
    if (this.targetWindows.has(targetWindow)) {
      this.targetWindows.delete(targetWindow);
      this._log(`Removed target window`);
    }
    return this;
  }

  /**​
   * 注册事件监听器
   * @param {string} eventName 事件名称
   * @param {Function} handler 处理函数
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  onEvent(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    if (!this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = [];
    }

    this.eventHandlers[eventName].push(handler);
    this._log(`Registered handler for event "${eventName}"`);
    return this;
  }

  /**​
   * 取消事件监听
   * @param {string} eventName 事件名称
   * @param {Function} [handler] 要移除的特定处理函数(不传则移除所有)
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  offEvent(eventName, handler) {
    if (!this.eventHandlers[eventName]) {
      return this;
    }

    if (handler) {
      const index = this.eventHandlers[eventName].indexOf(handler);
      if (index !== -1) {
        this.eventHandlers[eventName].splice(index, 1);
        this._log(`Removed one handler for event "${eventName}"`);
      }
    } else {
      delete this.eventHandlers[eventName];
      this._log(`Removed all handlers for event "${eventName}"`);
    }

    return this;
  }

  /**​
   * 注册请求处理器
   * @param {string} eventName 请求名称
   * @param {Function} handler 处理函数(应返回响应数据)
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  onRequest(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    this.requestHandlers[eventName] = handler;
    this._log(`Registered handler for request "${eventName}"`);
    return this;
  }

  /**​
   * 注册一次性请求处理器
   * @param {string} eventName 请求名称
   * @param {Function} handler 处理函数(应返回响应数据)
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  onceRequest(eventName, handler) {
    const onceHandler = (params) => {
      const result = handler(params);
      this.offRequest(eventName);
      return result;
    };

    return this.onRequest(eventName, onceHandler);
  }

  /**​
   * 取消请求处理器
   * @param {string} eventName 请求名称
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  offRequest(eventName) {
    if (this.requestHandlers[eventName]) {
      delete this.requestHandlers[eventName];
      this._log(`Removed handler for request "${eventName}"`);
    }
    return this;
  }

  /**​
   * 发送事件到所有目标窗口
   * @param {string} eventName 事件名称
   * @param {*} [params] 事件参数
   * @returns {string} 消息ID
   */
  emitEvent(eventName, params = {}) {
    if (typeof eventName !== 'string') {
      throw new Error('Event name must be a string');
    }

    return this._sendToAll('event', {
      eventName,
      params
    });
  }

  /**​
   * 发送请求到所有目标窗口并等待响应
   * @param {string} eventName 请求名称
   * @param {*} [params] 请求参数
   * @returns {Promise} 返回Promise，解析为响应数据
   */
  request(eventName, params = {}) {
    if (typeof eventName !== 'string') {
      return Promise.reject(new Error('Request name must be a string'));
    }

    return new Promise((resolve, reject) => {
      const messageId = this._sendToAll('request', {
        eventName,
        params
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        delete this.messageHandlers[messageId];
        this.pendingMessages.delete(messageId);
        reject(new Error(`Request "${eventName}" timed out after ${this.settings.messageTimeout}ms`));
      }, this.settings.messageTimeout);

      // 注册响应处理器
      this.messageHandlers[messageId] = (response) => {
        clearTimeout(timeoutId);
        resolve(response);
      };
    });
  }

  /**​
   * 启动心跳检测
   * @param {number} [interval=30000] 心跳间隔(毫秒)
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  startHeartbeat(interval = 30000) {
    if (this.heartbeatInterval) {
      this._log('Heartbeat already running');
      return this;
    }

    this.heartbeatInterval = setInterval(() => {
      this.heartbeatCounter++;
      this._sendToAll('heartbeat', {
        counter: this.heartbeatCounter
      });
      this._log(`Sent heartbeat #${this.heartbeatCounter}`);
    }, interval);

    this._log(`Started heartbeat with ${interval}ms interval`);
    return this;
  }

  /**​
   * 停止心跳检测
   * @returns {CrossWindowCom} 返回自身以便链式调用
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this._log('Stopped heartbeat');
    }
    return this;
  }

  /**​
   * 销毁实例，清理所有资源
   */
  destroy() {
    // 移除事件监听
    window.removeEventListener('message', this._messageListener);

    // 清理所有定时器
    this.stopHeartbeat();
    Object.values(this.messageHandlers).forEach(handler => {
      if (handler.timeoutId) clearTimeout(handler.timeoutId);
    });

    // 清空所有存储
    this.targetWindows.clear();
    this.eventHandlers = {};
    this.requestHandlers = {};
    this.messageHandlers = {};
    this.pendingMessages.clear();

    this._log('Instance destroyed');
  }
}

// 模块导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CrossWindowCom;
} else if (typeof layui !== 'undefined' && layui.define) {
  layui.define(function (exports) {
    exports('CrossWindowCom', CrossWindowCom);
  });
} else if (typeof define === 'function' && define.amd) {
  define([], () => CrossWindowCom);
} else {
  window.CrossWindowCom = CrossWindowCom;
}