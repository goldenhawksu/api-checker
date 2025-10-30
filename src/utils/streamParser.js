/**
 * 流式API响应解析器
 * 支持OpenAI兼容格式的Server-Sent Events解析
 */

export class StreamParser {
  constructor() {
    this.buffer = '';
    this.eventHandlers = new Map();
    this.metrics = {
      ttfb: null,           // 首字节时间
      firstTokenTime: null, // 第一个token时间
      lastTokenTime: null,  // 最后一个token时间
      tokenCount: 0,        // token数量
      totalTokens: 0,       // 总token数（包括content和usage）
      chunks: [],          // 接收到的数据块
      errors: []           // 错误记录
    };
    this.startTime = null;
    this.isCompleted = false;
  }

  /**
   * 添加事件监听器
   */
  on(event, callback) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(callback);
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Event handler error for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 解析Server-Sent Events数据
   */
  parseData(chunk) {
    this.buffer += chunk;

    // 记录首字节时间
    if (!this.metrics.ttfb && this.buffer.length > 0) {
      this.metrics.ttfb = Date.now() - this.startTime;
      this.emit('ttfb', this.metrics.ttfb);
    }

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留最后一行（可能不完整）

    let eventData = {};
    let currentEvent = null;

    for (const line of lines) {
      if (line.trim() === '') {
        // 空行表示一个事件的结束
        if (Object.keys(eventData).length > 0) {
          this.processEvent(eventData);
          eventData = {};
        }
        continue;
      }

      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          this.completeStream();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          Object.assign(eventData, parsed);
        } catch (error) {
          // 处理非JSON格式的数据
          eventData.content = (eventData.content || '') + data;
        }
      } else if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
        eventData.event = currentEvent;
      } else if (line.startsWith('id: ')) {
        eventData.id = line.slice(4);
      } else if (line.startsWith('retry: ')) {
        eventData.retry = parseInt(line.slice(7));
      }
    }

    // 处理剩余的事件数据
    if (Object.keys(eventData).length > 0) {
      this.processEvent(eventData);
    }
  }

  /**
   * 处理解析后的事件数据
   */
  processEvent(eventData) {
    const timestamp = Date.now();

    // 记录第一个token时间
    if (!this.metrics.firstTokenTime && (eventData.content || eventData.choices?.[0]?.delta?.content)) {
      this.metrics.firstTokenTime = timestamp - this.startTime;
      this.emit('firstToken', this.metrics.firstTokenTime);
    }

    // 提取内容
    let content = '';
    if (eventData.choices && eventData.choices.length > 0) {
      const delta = eventData.choices[0].delta || {};
      content = delta.content || '';
    } else if (eventData.content) {
      content = eventData.content;
    }

    if (content) {
      this.metrics.tokenCount++;
      this.metrics.lastTokenTime = timestamp - this.startTime;

      this.emit('token', {
        content,
        timestamp,
        tokenIndex: this.metrics.tokenCount,
        cumulativeTime: this.metrics.lastTokenTime
      });
    }

    // 记录usage信息
    if (eventData.usage) {
      this.metrics.totalTokens = eventData.usage.total_tokens || 0;
      this.emit('usage', eventData.usage);
    }

    // 记录错误信息
    if (eventData.error) {
      this.metrics.errors.push({
        error: eventData.error,
        timestamp
      });
      this.emit('error', eventData.error);
    }

    // 存储原始数据块
    this.metrics.chunks.push({
      data: eventData,
      timestamp,
      size: JSON.stringify(eventData).length
    });

    this.emit('progress', {
      ...this.metrics,
      currentContent: content
    });
  }

  /**
   * 完成流式解析
   */
  completeStream() {
    if (this.isCompleted) return;

    this.isCompleted = true;
    const totalTime = Date.now() - this.startTime;

    const finalMetrics = {
      ...this.metrics,
      totalTime,
      tokensPerSecond: this.metrics.tokenCount > 0 ? (this.metrics.tokenCount / (totalTime / 1000)).toFixed(2) : 0,
      averageTokenInterval: this.metrics.tokenCount > 1 ?
        (this.metrics.lastTokenTime - this.metrics.firstTokenTime) / (this.metrics.tokenCount - 1) : 0
    };

    this.emit('complete', finalMetrics);
  }

  /**
   * 开始解析流
   */
  start() {
    this.startTime = Date.now();
    this.reset();
    this.emit('start', { timestamp: this.startTime });
  }

  /**
   * 重置解析器状态
   */
  reset() {
    this.buffer = '';
    this.metrics = {
      ttfb: null,
      firstTokenTime: null,
      lastTokenTime: null,
      tokenCount: 0,
      totalTokens: 0,
      chunks: [],
      errors: []
    };
    this.isCompleted = false;
  }

  /**
   * 获取当前指标
   */
  getMetrics() {
    const currentTime = Date.now() - this.startTime;
    return {
      ...this.metrics,
      currentTime,
      isCompleted: this.isCompleted
    };
  }
}

/**
 * 流式API客户端
 */
export class StreamApiClient {
  constructor() {
    this.parser = new StreamParser();
  }

  /**
   * 执行流式API请求
   */
  async request(url, options = {}) {
    const {
      onProgress,
      onToken,
      onComplete,
      onError,
      onTTFB,
      onFirstToken,
      onUsage,
      timeout = 30000
    } = options;

    // 设置事件监听器
    if (onProgress) this.parser.on('progress', onProgress);
    if (onToken) this.parser.on('token', onToken);
    if (onComplete) this.parser.on('complete', onComplete);
    if (onError) this.parser.on('error', onError);
    if (onTTFB) this.parser.on('ttfb', onTTFB);
    if (onFirstToken) this.parser.on('firstToken', onFirstToken);
    if (onUsage) this.parser.on('usage', onUsage);

    try {
      this.parser.start();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          this.parser.parseData(chunk);
        }
      } finally {
        reader.releaseLock();
      }

      // 确保流完成
      this.parser.completeStream();

    } catch (error) {
      this.parser.emit('error', error);
      throw error;
    }
  }

  /**
   * 获取解析器实例
   */
  getParser() {
    return this.parser;
  }
}

/**
 * 非流式API客户端（用于对比测试）
 */
export class NonStreamApiClient {
  async request(url, options = {}) {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 提取内容
      let content = '';
      if (data.choices && data.choices.length > 0) {
        content = data.choices[0].message?.content || '';
      }

      return {
        success: true,
        responseTime,
        content,
        usage: data.usage,
        model: data.model,
        rawResponse: data
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }
}

/**
 * 性能对比测试器
 */
export class PerformanceComparator {
  constructor() {
    this.streamClient = new StreamApiClient();
    this.nonStreamClient = new NonStreamApiClient();
  }

  async compare(requestConfig, testOptions = {}) {
    const { iterations = 1, delay = 1000 } = testOptions;
    const results = {
      stream: [],
      nonStream: [],
      comparison: null
    };

    for (let i = 0; i < iterations; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // 流式测试
      const streamResult = await this.runStreamTest(requestConfig);
      results.stream.push(streamResult);

      await new Promise(resolve => setTimeout(resolve, delay / 2));

      // 非流式测试
      const nonStreamResult = await this.runNonStreamTest(requestConfig);
      results.nonStream.push(nonStreamResult);
    }

    // 计算对比数据
    results.comparison = this.calculateComparison(results);

    return results;
  }

  async runStreamTest(requestConfig) {
    return new Promise((resolve, reject) => {
      let metrics = null;

      const onComplete = (data) => {
        metrics = data;
      };

      const onError = (error) => {
        reject(error);
      };

      this.streamClient.request(requestConfig.url, {
        ...requestConfig,
        stream: true,
        onComplete,
        onError
      }).then(() => {
        resolve({
          type: 'stream',
          metrics,
          success: true
        });
      }).catch(reject);
    });
  }

  async runNonStreamTest(requestConfig) {
    const result = await this.nonStreamClient.request(requestConfig.url, requestConfig);

    return {
      type: 'nonStream',
      ...result
    };
  }

  calculateComparison(results) {
    const streamMetrics = results.stream.map(r => r.metrics);
    const nonStreamMetrics = results.nonStream.map(r => r);

    const streamAvgTTFB = streamMetrics.filter(m => m?.ttfb).reduce((sum, m, _, arr) => sum + m.ttfb / arr.length, 0);
    const nonStreamAvgTime = nonStreamMetrics.filter(m => m?.responseTime).reduce((sum, m, _, arr) => sum + m.responseTime / arr.length, 0);
    const streamAvgTokensPerSec = streamMetrics.filter(m => m?.tokensPerSecond).reduce((sum, m, _, arr) => sum + parseFloat(m.tokensPerSecond) / arr.length, 0);

    return {
      stream: {
        averageTTFB: streamAvgTTFB || 0,
        averageTokensPerSecond: streamAvgTokensPerSec || 0,
        successRate: results.stream.filter(r => r.success).length / results.stream.length
      },
      nonStream: {
        averageResponseTime: nonStreamAvgTime || 0,
        successRate: results.nonStream.filter(r => r.success).length / results.nonStream.length
      }
    };
  }
}