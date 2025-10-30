/**
 * 实时性能监控器
 * 用于收集和分析流式API的实时性能指标
 */

import { StreamApiClient, NonStreamApiClient, PerformanceComparator } from './streamParser.js';

export class PerformanceMonitor {
  constructor() {
    this.metrics = {
      realtime: [],
      historical: [],
      summary: null
    };
    this.isMonitoring = false;
    this.currentTest = null;
    this.updateCallbacks = new Set();
    this.alerts = [];
  }

  /**
   * 开始监控
   */
  startMonitoring(config) {
    this.isMonitoring = true;
    this.currentTest = {
      id: Date.now(),
      config,
      startTime: Date.now(),
      models: []
    };

    this.notifyUpdate('monitoringStarted', { config });
  }

  /**
   * 停止监控
   */
  stopMonitoring() {
    this.isMonitoring = false;
    if (this.currentTest) {
      this.currentTest.endTime = Date.now();
      this.currentTest.duration = this.currentTest.endTime - this.currentTest.startTime;
      this.metrics.historical.push(this.currentTest);
    }

    this.notifyUpdate('monitoringStopped', { test: this.currentTest });
    this.currentTest = null;
  }

  /**
   * 监控单个模型的流式性能
   */
  async monitorStreamModel(modelName, requestConfig, progressCallback) {
    const client = new StreamApiClient();
    const modelMetrics = {
      modelName,
      type: 'stream',
      startTime: Date.now(),
      metrics: null,
      success: false,
      error: null,
      tokens: [],
      timeline: []
    };

    try {
      const startTime = Date.now();

      // 设置进度回调
      client.getParser().on('progress', (data) => {
        modelMetrics.timeline.push({
          timestamp: Date.now() - startTime,
          tokenCount: data.tokenCount,
          currentSpeed: data.tokenCount > 0 ? (data.tokenCount / ((Date.now() - startTime) / 1000)).toFixed(2) : 0
        });

        if (progressCallback) {
          progressCallback({
            model: modelName,
            type: 'stream',
            progress: data
          });
        }

        this.notifyUpdate('modelProgress', {
          model: modelName,
          type: 'stream',
          data
        });
      });

      client.getParser().on('token', (tokenData) => {
        modelMetrics.tokens.push(tokenData);
        this.updateRealtimeMetrics(modelName, 'token', tokenData);
      });

      client.getParser().on('complete', (metrics) => {
        modelMetrics.metrics = metrics;
        modelMetrics.success = true;
        modelMetrics.endTime = Date.now();
        modelMetrics.duration = modelMetrics.endTime - modelMetrics.startTime;

        this.updateRealtimeMetrics(modelName, 'complete', metrics);

        if (progressCallback) {
          progressCallback({
            model: modelName,
            type: 'stream',
            complete: true,
            metrics
          });
        }
      });

      client.getParser().on('error', (error) => {
        modelMetrics.error = error;
        modelMetrics.success = false;
        modelMetrics.endTime = Date.now();
        modelMetrics.duration = modelMetrics.endTime - modelMetrics.startTime;

        this.addAlert('error', `${modelName} 流式测试失败: ${error.message}`);
        this.updateRealtimeMetrics(modelName, 'error', error);
      });

      // 执行请求
      await client.request(requestConfig.url, {
        method: 'POST',
        headers: requestConfig.headers,
        body: JSON.stringify(requestConfig.body),
        stream: true
      });

    } catch (error) {
      modelMetrics.error = error.message;
      modelMetrics.success = false;
      modelMetrics.endTime = Date.now();
      modelMetrics.duration = modelMetrics.endTime - modelMetrics.startTime;

      this.addAlert('error', `${modelName} 流式请求异常: ${error.message}`);
    }

    if (this.currentTest) {
      this.currentTest.models.push(modelMetrics);
    }

    return modelMetrics;
  }

  /**
   * 监控单个模型的非流式性能
   */
  async monitorNonStreamModel(modelName, requestConfig, progressCallback) {
    const client = new NonStreamApiClient();
    const modelMetrics = {
      modelName,
      type: 'nonStream',
      startTime: Date.now(),
      metrics: null,
      success: false,
      error: null
    };

    try {
      const result = await client.request(requestConfig.url, {
        method: 'POST',
        headers: requestConfig.headers,
        body: JSON.stringify(requestConfig.body)
      });

      modelMetrics.metrics = {
        responseTime: result.responseTime,
        contentLength: result.content ? result.content.length : 0,
        usage: result.usage,
        model: result.model
      };
      modelMetrics.success = result.success;
      modelMetrics.error = result.error;
      modelMetrics.endTime = Date.now();
      modelMetrics.duration = modelMetrics.endTime - modelMetrics.startTime;

      if (progressCallback) {
        progressCallback({
          model: modelName,
          type: 'nonStream',
          result
        });
      }

      this.updateRealtimeMetrics(modelName, 'complete', modelMetrics.metrics);

    } catch (error) {
      modelMetrics.error = error.message;
      modelMetrics.success = false;
      modelMetrics.endTime = Date.now();
      modelMetrics.duration = modelMetrics.endTime - modelMetrics.startTime;

      this.addAlert('error', `${modelName} 非流式测试失败: ${error.message}`);
      this.updateRealtimeMetrics(modelName, 'error', error);
    }

    if (this.currentTest) {
      this.currentTest.models.push(modelMetrics);
    }

    return modelMetrics;
  }

  /**
   * 对比测试流式和非流式性能
   */
  async compareModelPerformance(modelName, requestConfig, options = {}) {
    const comparator = new PerformanceComparator();

    try {
      const comparisonResult = await comparator.compare(
        {
          url: requestConfig.url,
          headers: requestConfig.headers,
          body: requestConfig.body
        },
        options
      );

      const summary = {
        modelName,
        stream: comparisonResult.stream,
        nonStream: comparisonResult.nonStream,
        recommendation: this.generateRecommendation(comparisonResult),
        timestamp: Date.now()
      };

      this.updateRealtimeMetrics(modelName, 'comparison', summary);

      return summary;

    } catch (error) {
      this.addAlert('error', `${modelName} 性能对比失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量监控多个模型
   */
  async monitorModels(modelNames, requestConfig, options = {}) {
    const {
      concurrent = false,
      progressCallback,
      includeComparison = false
    } = options;

    const results = [];

    if (concurrent) {
      // 并发测试
      const promises = modelNames.map(async (modelName) => {
        try {
          const streamResult = await this.monitorStreamModel(modelName, requestConfig, progressCallback);
          const nonStreamResult = await this.monitorNonStreamModel(modelName, requestConfig, progressCallback);

          const result = {
            modelName,
            stream: streamResult,
            nonStream: nonStreamResult
          };

          if (includeComparison) {
            result.comparison = await this.compareModelPerformance(modelName, requestConfig);
          }

          return result;

        } catch (error) {
          return {
            modelName,
            error: error.message
          };
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

    } else {
      // 串行测试
      for (const modelName of modelNames) {
        try {
          const streamResult = await this.monitorStreamModel(modelName, requestConfig, progressCallback);
          const nonStreamResult = await this.monitorNonStreamModel(modelName, requestConfig, progressCallback);

          const result = {
            modelName,
            stream: streamResult,
            nonStream: nonStreamResult
          };

          if (includeComparison) {
            result.comparison = await this.compareModelPerformance(modelName, requestConfig);
          }

          results.push(result);

        } catch (error) {
          results.push({
            modelName,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  /**
   * 更新实时指标
   */
  updateRealtimeMetrics(modelName, eventType, data) {
    const metric = {
      modelName,
      eventType,
      data,
      timestamp: Date.now()
    };

    this.metrics.realtime.push(metric);

    // 保持最近1000条记录
    if (this.metrics.realtime.length > 1000) {
      this.metrics.realtime = this.metrics.realtime.slice(-1000);
    }

    this.notifyUpdate('metricsUpdate', metric);
  }

  /**
   * 生成性能建议
   */
  generateRecommendation(comparisonResult) {
    const { stream, nonStream } = comparisonResult;

    let recommendation = '';

    if (stream.averageTTFB < nonStream.averageResponseTime) {
      recommendation += '流式响应更快，适合实时交互场景。';
    } else {
      recommendation += '非流式响应更快，适合批量处理场景。';
    }

    if (stream.averageTokensPerSecond > 50) {
      recommendation += '流式token生成速度优秀。';
    } else if (stream.averageTokensPerSecond > 20) {
      recommendation += '流式token生成速度良好。';
    } else {
      recommendation += '流式token生成速度较慢，建议优化。';
    }

    if (stream.successRate < nonStream.successRate) {
      recommendation += '非流式成功率更高，稳定性更好。';
    } else {
      recommendation += '流式成功率更高，推荐使用。';
    }

    return recommendation;
  }

  /**
   * 添加警报
   */
  addAlert(type, message, severity = 'warning') {
    const alert = {
      id: Date.now(),
      type,
      message,
      severity,
      timestamp: Date.now()
    };

    this.alerts.push(alert);

    // 保持最近50条警报
    if (this.alerts.length > 50) {
      this.alerts = this.alerts.slice(-50);
    }

    this.notifyUpdate('alert', alert);
  }

  /**
   * 注册更新回调
   */
  onUpdate(callback) {
    this.updateCallbacks.add(callback);
  }

  /**
   * 移除更新回调
   */
  removeUpdateCallback(callback) {
    this.updateCallbacks.delete(callback);
  }

  /**
   * 通知更新
   */
  notifyUpdate(event, data) {
    this.updateCallbacks.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Update callback error:', error);
      }
    });
  }

  /**
   * 获取实时指标
   */
  getRealtimeMetrics() {
    return this.metrics.realtime;
  }

  /**
   * 获取历史数据
   */
  getHistoricalData() {
    return this.metrics.historical;
  }

  /**
   * 获取当前测试状态
   */
  getCurrentTest() {
    return this.currentTest;
  }

  /**
   * 获取警报列表
   */
  getAlerts() {
    return this.alerts;
  }

  /**
   * 清除警报
   */
  clearAlerts() {
    this.alerts = [];
    this.notifyUpdate('alertsCleared', {});
  }

  /**
   * 导出性能数据
   */
  exportData() {
    return {
      metrics: this.metrics,
      alerts: this.alerts,
      timestamp: Date.now(),
      version: '1.0.0'
    };
  }

  /**
   * 导入性能数据
   */
  importData(data) {
    if (data.metrics) {
      this.metrics = data.metrics;
    }
    if (data.alerts) {
      this.alerts = data.alerts;
    }
    this.notifyUpdate('dataImported', data);
  }

  /**
   * 清除所有数据
   */
  clearAll() {
    this.metrics = {
      realtime: [],
      historical: [],
      summary: null
    };
    this.alerts = [];
    this.currentTest = null;
    this.isMonitoring = false;

    this.notifyUpdate('dataCleared', {});
  }
}

/**
 * 性能指标计算器
 */
export class MetricsCalculator {
  /**
   * 计算平均响应时间
   */
  static calculateAverageResponseTime(data) {
    const validTimes = data.filter(item => item.responseTime > 0);
    if (validTimes.length === 0) return 0;

    const sum = validTimes.reduce((acc, item) => acc + item.responseTime, 0);
    return (sum / validTimes.length).toFixed(2);
  }

  /**
   * 计算成功率
   */
  static calculateSuccessRate(data) {
    if (data.length === 0) return 0;

    const successCount = data.filter(item => item.success !== false).length;
    return ((successCount / data.length) * 100).toFixed(2);
  }

  /**
   * 计算Token生成速度
   */
  static calculateTokensPerSecond(data) {
    const validData = data.filter(item =>
      item.tokenCount > 0 && item.totalTime > 0
    );

    if (validData.length === 0) return 0;

    const speeds = validData.map(item =>
      item.tokenCount / (item.totalTime / 1000)
    );

    const sum = speeds.reduce((acc, speed) => acc + speed, 0);
    return (sum / speeds.length).toFixed(2);
  }

  /**
   * 计算延迟分布
   */
  static calculateLatencyDistribution(data) {
    const latencies = data.filter(item => item.ttfb > 0).map(item => item.ttfb);

    if (latencies.length === 0) {
      return { min: 0, max: 0, median: 0, p95: 0, p99: 0 };
    }

    latencies.sort((a, b) => a - b);

    return {
      min: latencies[0],
      max: latencies[latencies.length - 1],
      median: latencies[Math.floor(latencies.length / 2)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[Math.floor(latencies.length * 0.99)]
    };
  }

  /**
   * 计算性能评分
   */
  static calculatePerformanceScore(metrics) {
    let score = 100;

    // 响应时间评分 (40%)
    if (metrics.averageResponseTime > 5000) score -= 20;
    else if (metrics.averageResponseTime > 3000) score -= 15;
    else if (metrics.averageResponseTime > 1000) score -= 10;
    else if (metrics.averageResponseTime > 500) score -= 5;

    // 成功率评分 (30%)
    score -= (100 - parseFloat(metrics.successRate)) * 0.3;

    // Token速度评分 (30%)
    if (metrics.tokensPerSecond < 10) score -= 30;
    else if (metrics.tokensPerSecond < 20) score -= 20;
    else if (metrics.tokensPerSecond < 50) score -= 10;
    else if (metrics.tokensPerSecond < 100) score -= 5;

    return Math.max(0, Math.round(score));
  }
}