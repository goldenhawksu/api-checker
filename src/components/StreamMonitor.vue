<template>
  <div class="stream-monitor">
    <!-- 监控控制面板 -->
    <div class="monitor-controls">
      <a-space>
        <a-button
          type="primary"
          :loading="isMonitoring"
          @click="toggleMonitoring"
        >
          <template #icon>
            <PlayCircleOutlined v-if="!isMonitoring" />
            <PauseCircleOutlined v-else />
          </template>
          {{ isMonitoring ? t('STOP_MONITORING') : t('START_MONITORING') }}
        </a-button>

        <a-button
          @click="clearData"
          :disabled="isMonitoring"
        >
          <template #icon>
            <ClearOutlined />
          </template>
          {{ t('CLEAR_DATA') }}
        </a-button>

        <a-button
          @click="exportData"
          :disabled="metrics.realtime.length === 0"
        >
          <template #icon>
            <DownloadOutlined />
          </template>
          {{ t('EXPORT_DATA') }}
        </a-button>

        <a-select
          v-model:value="monitorMode"
          :placeholder="t('SELECT_MONITOR_MODE')"
          style="width: 150px"
          @change="handleModeChange"
        >
          <a-select-option value="stream">{{ t('STREAM_MODE') }}</a-select-option>
          <a-select-option value="nonStream">{{ t('NON_STREAM_MODE') }}</a-select-option>
          <a-select-option value="comparison">{{ t('COMPARISON_MODE') }}</a-select-option>
        </a-select>

        <a-switch
          v-model:checked="autoRefresh"
          :checked-children="t('AUTO_REFRESH')"
          :un-checked-children="t('MANUAL_REFRESH')"
        />
      </a-space>
    </div>

    <!-- 实时性能指标卡片 -->
    <div class="metrics-cards">
      <a-row :gutter="16">
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              :title="t('AVERAGE_RESPONSE_TIME')"
              :value="currentMetrics.averageResponseTime"
              suffix="ms"
              :value-style="{ color: responseTimeColor }"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              :title="t('SUCCESS_RATE')"
              :value="currentMetrics.successRate"
              suffix="%"
              :value-style="{ color: successRateColor }"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              :title="t('TOKENS_PER_SECOND')"
              :value="currentMetrics.tokensPerSecond"
              :value-style="{ color: tokenSpeedColor }"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              :title="t('ACTIVE_CONNECTIONS')"
              :value="activeConnections"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 图表区域 -->
    <div class="charts-container">
      <a-row :gutter="16">
        <!-- 响应时间趋势图 -->
        <a-col :span="12">
          <a-card :title="t('RESPONSE_TIME_TREND')" size="small">
            <div ref="responseTimeChartRef" class="chart-container"></div>
          </a-card>
        </a-col>

        <!-- Token生成速度图 -->
        <a-col :span="12">
          <a-card :title="t('TOKEN_SPEED_TREND')" size="small">
            <div ref="tokenSpeedChartRef" class="chart-container"></div>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="16" style="margin-top: 16px">
        <!-- 成功率分布图 -->
        <a-col :span="8">
          <a-card :title="t('SUCCESS_RATE_DISTRIBUTION')" size="small">
            <div ref="successRateChartRef" class="chart-container"></div>
          </a-card>
        </a-col>

        <!-- 模型性能对���图 -->
        <a-col :span="8">
          <a-card :title="t('MODEL_PERFORMANCE_COMPARISON')" size="small">
            <div ref="modelComparisonChartRef" class="chart-container"></div>
          </a-card>
        </a-col>

        <!-- 延迟分布图 -->
        <a-col :span="8">
          <a-card :title="t('LATENCY_DISTRIBUTION')" size="small">
            <div ref="latencyChartRef" class="chart-container"></div>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 实时日志区域 -->
    <div class="logs-container">
      <a-card :title="t('REALTIME_LOGS')" size="small">
        <template #extra>
          <a-space>
            <a-switch
              v-model:checked="autoScroll"
              size="small"
              :checked-children="t('AUTO_SCROLL')"
              :un-checked-children="t('MANUAL_SCROLL')"
            />
            <a-button size="small" @click="clearLogs">
              {{ t('CLEAR_LOGS') }}
            </a-button>
          </a-space>
        </template>

        <div
          ref="logsContainerRef"
          class="logs-content"
          :style="{ height: '200px', overflowY: 'auto' }"
        >
          <div
            v-for="(log, index) in realtimeLogs"
            :key="log.id"
            class="log-item"
            :class="log.level"
          >
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-model">{{ log.modelName }}</span>
            <span class="log-message">{{ log.message }}</span>
            <span class="log-metrics" v-if="log.metrics">
              (TTFB: {{ log.metrics.ttfb }}ms,
              Tokens: {{ log.metrics.tokenCount }})
            </span>
          </div>
        </div>
      </a-card>
    </div>

    <!-- 警报区域 -->
    <div class="alerts-container" v-if="alerts.length > 0">
      <a-alert
        v-for="alert in alerts.slice(-3)"
        :key="alert.id"
        :message="alert.message"
        :type="alert.severity"
        show-icon
        closable
        @close="dismissAlert(alert.id)"
        style="margin-bottom: 8px"
      >
        <template #description>
          {{ formatTime(alert.timestamp) }}
        </template>
      </a-alert>
    </div>

    <!-- 模型测试对话框 -->
    <a-modal
      v-model:open="showTestModal"
      :title="t('MODEL_PERFORMANCE_TEST')"
      width="800px"
      @ok="runModelTest"
      :confirm-loading="testRunning"
    >
      <a-form :model="testForm" layout="vertical">
        <a-form-item :label="t('SELECT_MODELS')">
          <a-select
            v-model:value="testForm.models"
            mode="multiple"
            :placeholder="t('SELECT_MODELS_TO_TEST')"
            style="width: 100%"
          >
            <a-select-option
              v-for="model in availableModels"
              :key="model"
              :value="model"
            >
              {{ model }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item :label="t('TEST_MODE')">
          <a-radio-group v-model:value="testForm.mode">
            <a-radio value="sequential">{{ t('SEQUENTIAL') }}</a-radio>
            <a-radio value="concurrent">{{ t('CONCURRENT') }}</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item :label="t('INCLUDE_COMPARISON')">
          <a-switch v-model:checked="testForm.includeComparison" />
        </a-form-item>

        <a-form-item :label="t('ITERATIONS')">
          <a-input-number
            v-model:value="testForm.iterations"
            :min="1"
            :max="10"
            style="width: 100px"
          />
        </a-form-item>
      </a-form>

      <div v-if="testResults.length > 0" class="test-results">
        <h4>{{ t('TEST_RESULTS') }}</h4>
        <a-table
          :columns="testResultColumns"
          :data-source="testResults"
          size="small"
          :pagination="false"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-tag :color="record.success ? 'green' : 'red'">
                {{ record.success ? t('SUCCESS') : t('FAILED') }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'responseTime'">
              {{ record.responseTime }}ms
            </template>
            <template v-else-if="column.key === 'tokensPerSecond'">
              {{ record.tokensPerSecond }}
            </template>
          </template>
        </a-table>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { message } from 'ant-design-vue';
import { useI18n } from 'vue-i18n';
import * as echarts from 'echarts/core';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent
} from 'echarts/components';
import { LineChart, BarChart, PieChart, RadarChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';

import { PerformanceMonitor, MetricsCalculator } from '../utils/performanceMonitor.js';

// 注册ECharts组件
echarts.use([
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  LineChart,
  BarChart,
  PieChart,
  RadarChart,
  CanvasRenderer
]);

const { t } = useI18n();

// 响应式数据
const isMonitoring = ref(false);
const monitorMode = ref('comparison');
const autoRefresh = ref(true);
const autoScroll = ref(true);
const showTestModal = ref(false);
const testRunning = ref(false);

const performanceMonitor = new PerformanceMonitor();
const metrics = reactive({
  realtime: [],
  historical: [],
  summary: null
});

const alerts = ref([]);
const realtimeLogs = ref([]);
const testResults = ref([]);
const availableModels = ref(['gpt-3.5-turbo', 'gpt-4', 'claude-3-sonnet', 'claude-3-haiku']);

const testForm = reactive({
  models: [],
  mode: 'sequential',
  includeComparison: true,
  iterations: 1
});

// 图表引用
const responseTimeChartRef = ref(null);
const tokenSpeedChartRef = ref(null);
const successRateChartRef = ref(null);
const modelComparisonChartRef = ref(null);
const latencyChartRef = ref(null);
const logsContainerRef = ref(null);

// 图表实例
let responseTimeChart = null;
let tokenSpeedChart = null;
let successRateChart = null;
let modelComparisonChart = null;
let latencyChart = null;

// 计算属性
const currentMetrics = computed(() => {
  if (metrics.realtime.length === 0) {
    return {
      averageResponseTime: 0,
      successRate: 0,
      tokensPerSecond: 0
    };
  }

  const latestMetrics = metrics.realtime.slice(-50); // 最近50条数据

  return {
    averageResponseTime: MetricsCalculator.calculateAverageResponseTime(latestMetrics),
    successRate: MetricsCalculator.calculateSuccessRate(latestMetrics),
    tokensPerSecond: MetricsCalculator.calculateTokensPerSecond(latestMetrics)
  };
});

const responseTimeColor = computed(() => {
  const time = currentMetrics.value.averageResponseTime;
  if (time > 3000) return '#ff4d4f';
  if (time > 1000) return '#fa8c16';
  return '#52c41a';
});

const successRateColor = computed(() => {
  const rate = parseFloat(currentMetrics.value.successRate);
  if (rate < 80) return '#ff4d4f';
  if (rate < 95) return '#fa8c16';
  return '#52c41a';
});

const tokenSpeedColor = computed(() => {
  const speed = parseFloat(currentMetrics.value.tokensPerSecond);
  if (speed < 10) return '#ff4d4f';
  if (speed < 30) return '#fa8c16';
  return '#52c41a';
});

const activeConnections = computed(() => {
  return performanceMonitor.getCurrentTest()?.models?.length || 0;
});

const testResultColumns = [
  {
    title: t('MODEL'),
    dataIndex: 'modelName',
    key: 'modelName'
  },
  {
    title: t('TYPE'),
    dataIndex: 'type',
    key: 'type'
  },
  {
    title: t('STATUS'),
    key: 'status'
  },
  {
    title: t('RESPONSE_TIME'),
    key: 'responseTime'
  },
  {
    title: t('TOKENS_PER_SECOND'),
    key: 'tokensPerSecond'
  }
];

// 方法
const toggleMonitoring = () => {
  if (isMonitoring.value) {
    performanceMonitor.stopMonitoring();
    isMonitoring.value = false;
  } else {
    startMonitoring();
  }
};

const startMonitoring = async () => {
  try {
    isMonitoring.value = true;

    const config = {
      mode: monitorMode.value,
      autoRefresh: autoRefresh.value
    };

    performanceMonitor.startMonitoring(config);

    // 设置更新回调
    performanceMonitor.onUpdate((event, data) => {
      handlePerformanceUpdate(event, data);
    });

    // 模拟开始监控一些模型
    await monitorModels();

  } catch (error) {
    message.error(t('MONITORING_START_FAILED'));
    isMonitoring.value = false;
  }
};

const monitorModels = async () => {
  const requestConfig = {
    url: '/api/chat/completions',
    headers: {
      'Authorization': 'Bearer test-key',
      'Content-Type': 'application/json'
    },
    body: {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: '测试流式响应' }],
      stream: monitorMode.value === 'stream'
    }
  };

  try {
    const results = await performanceMonitor.monitorModels(
      availableModels.value.slice(0, 3), // 测试前3个模型
      requestConfig,
      {
        concurrent: testForm.mode === 'concurrent',
        includeComparison: monitorMode.value === 'comparison',
        progressCallback: handleProgressUpdate
      }
    );

    addLog('info', t('MONITORING_COMPLETED'), 'System', results);

  } catch (error) {
    addLog('error', t('MONITORING_FAILED'), 'System', { error: error.message });
  }
};

const handlePerformanceUpdate = (event, data) => {
  switch (event) {
    case 'metricsUpdate':
      metrics.realtime.push(data);
      updateCharts();
      break;
    case 'alert':
      alerts.value.push(data);
      break;
    case 'modelProgress':
      handleProgressUpdate(data);
      break;
  }
};

const handleProgressUpdate = (data) => {
  if (data.progress?.complete) {
    addLog('success', t('MODEL_TEST_COMPLETED'), data.model, data.progress.metrics);
  } else if (data.progress) {
    addLog('info', t('MODEL_TESTING'), data.model, data.progress);
  }
};

const addLog = (level, message, modelName, metrics = null) => {
  const log = {
    id: Date.now() + Math.random(),
    level,
    message,
    modelName,
    metrics,
    timestamp: Date.now()
  };

  realtimeLogs.value.push(log);

  // 保持最近200条日志
  if (realtimeLogs.value.length > 200) {
    realtimeLogs.value = realtimeLogs.value.slice(-200);
  }

  // 自动滚动到底部
  if (autoScroll.value && logsContainerRef.value) {
    nextTick(() => {
      logsContainerRef.value.scrollTop = logsContainerRef.value.scrollHeight;
    });
  }
};

const clearData = () => {
  performanceMonitor.clearAll();
  metrics.realtime = [];
  metrics.historical = [];
  alerts.value = [];
  realtimeLogs.value = [];
  testResults.value = [];
  updateCharts();
  message.success(t('DATA_CLEARED'));
};

const clearLogs = () => {
  realtimeLogs.value = [];
};

const exportData = () => {
  const data = performanceMonitor.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `performance-monitor-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.success(t('DATA_EXPORTED'));
};

const handleModeChange = (value) => {
  if (isMonitoring.value) {
    performanceMonitor.stopMonitoring();
    setTimeout(() => startMonitoring(), 500);
  }
};

const dismissAlert = (alertId) => {
  alerts.value = alerts.value.filter(alert => alert.id !== alertId);
};

const runModelTest = async () => {
  if (testForm.models.length === 0) {
    message.warning(t('PLEASE_SELECT_MODELS'));
    return;
  }

  testRunning.value = true;
  testResults.value = [];

  try {
    const requestConfig = {
      url: '/api/chat/completions',
      headers: {
        'Authorization': 'Bearer test-key',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: '性能测试' }],
        stream: false
      }
    };

    const results = await performanceMonitor.monitorModels(
      testForm.models,
      requestConfig,
      {
        concurrent: testForm.mode === 'concurrent',
        includeComparison: testForm.includeComparison,
        iterations: testForm.iterations
      }
    );

    testResults.value = results.map(result => ({
      modelName: result.modelName,
      type: result.stream?.type || 'unknown',
      success: result.stream?.success || result.nonStream?.success || false,
      responseTime: result.stream?.metrics?.totalTime || result.nonStream?.metrics?.responseTime || 0,
      tokensPerSecond: result.stream?.metrics?.tokensPerSecond || 0
    }));

    message.success(t('TEST_COMPLETED'));

  } catch (error) {
    message.error(t('TEST_FAILED'));
  } finally {
    testRunning.value = false;
  }
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

// 图表初始化和更新
const initCharts = () => {
  // 响应时间趋势图
  responseTimeChart = echarts.init(responseTimeChartRef.value);

  // Token速度图
  tokenSpeedChart = echarts.init(tokenSpeedChartRef.value);

  // 成功率分布图
  successRateChart = echarts.init(successRateChartRef.value);

  // 模型对比图
  modelComparisonChart = echarts.init(modelComparisonChartRef.value);

  // 延迟分布图
  latencyChart = echarts.init(latencyChartRef.value);

  updateCharts();
};

const updateCharts = () => {
  updateResponseTimeChart();
  updateTokenSpeedChart();
  updateSuccessRateChart();
  updateModelComparisonChart();
  updateLatencyChart();
};

const updateResponseTimeChart = () => {
  if (!responseTimeChart) return;

  const data = metrics.realtime.slice(-50);
  const times = data.map((_, index) => index);
  const responseTimes = data.map(item =>
    item.data?.totalTime || item.data?.responseTime || 0
  );

  const option = {
    title: {
      text: '',
      textStyle: { fontSize: 12 }
    },
    tooltip: {
      trigger: 'axis'
    },
    xAxis: {
      type: 'category',
      data: times,
      show: false
    },
    yAxis: {
      type: 'value',
      name: 'ms'
    },
    series: [{
      data: responseTimes,
      type: 'line',
      smooth: true,
      lineStyle: { color: '#1890ff' },
      areaStyle: { opacity: 0.1 }
    }]
  };

  responseTimeChart.setOption(option);
};

const updateTokenSpeedChart = () => {
  if (!tokenSpeedChart) return;

  const data = metrics.realtime.slice(-50);
  const times = data.map((_, index) => index);
  const tokenSpeeds = data.map(item =>
    parseFloat(item.data?.tokensPerSecond) || 0
  );

  const option = {
    title: {
      text: '',
      textStyle: { fontSize: 12 }
    },
    tooltip: {
      trigger: 'axis'
    },
    xAxis: {
      type: 'category',
      data: times,
      show: false
    },
    yAxis: {
      type: 'value',
      name: 'tokens/s'
    },
    series: [{
      data: tokenSpeeds,
      type: 'line',
      smooth: true,
      lineStyle: { color: '#52c41a' },
      areaStyle: { opacity: 0.1 }
    }]
  };

  tokenSpeedChart.setOption(option);
};

const updateSuccessRateChart = () => {
  if (!successRateChart) return;

  const modelStats = {};
  metrics.realtime.forEach(item => {
    const model = item.modelName;
    if (!modelStats[model]) {
      modelStats[model] = { success: 0, total: 0 };
    }
    modelStats[model].total++;
    if (item.eventType === 'complete' && item.data?.error !== undefined) {
      modelStats[model].success++;
    }
  });

  const data = Object.entries(modelStats).map(([model, stats]) => ({
    name: model,
    value: stats.total > 0 ? (stats.success / stats.total * 100).toFixed(1) : 0
  }));

  const option = {
    title: {
      text: '',
      textStyle: { fontSize: 12 }
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}%'
    },
    series: [{
      type: 'pie',
      radius: '70%',
      data: data,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  };

  successRateChart.setOption(option);
};

const updateModelComparisonChart = () => {
  if (!modelComparisonChart) return;

  const modelData = {};
  metrics.realtime.forEach(item => {
    const model = item.modelName;
    if (!modelData[model]) {
      modelData[model] = {
        responseTime: [],
        tokenSpeed: [],
        successRate: []
      };
    }

    if (item.data?.totalTime) {
      modelData[model].responseTime.push(item.data.totalTime);
    }
    if (item.data?.tokensPerSecond) {
      modelData[model].tokenSpeed.push(parseFloat(item.data.tokensPerSecond));
    }
  });

  const indicators = [
    { name: '响应时间', max: 5000 },
    { name: 'Token速度', max: 100 },
    { name: '成功率', max: 100 }
  ];

  const series = Object.entries(modelData).map(([model, data]) => {
    const avgResponseTime = data.responseTime.length > 0
      ? data.responseTime.reduce((a, b) => a + b, 0) / data.responseTime.length
      : 0;
    const avgTokenSpeed = data.tokenSpeed.length > 0
      ? data.tokenSpeed.reduce((a, b) => a + b, 0) / data.tokenSpeed.length
      : 0;
    const successRate = 100; // 简化处理

    return {
      name: model,
      value: [avgResponseTime, avgTokenSpeed, successRate]
    };
  });

  const option = {
    title: {
      text: '',
      textStyle: { fontSize: 12 }
    },
    tooltip: {},
    radar: {
      indicator: indicators
    },
    series: [{
      type: 'radar',
      data: series
    }]
  };

  modelComparisonChart.setOption(option);
};

const updateLatencyChart = () => {
  if (!latencyChart) return;

  const latencies = metrics.realtime
    .map(item => item.data?.ttfb)
    .filter(time => time > 0)
    .sort((a, b) => a - b);

  if (latencies.length === 0) return;

  const bins = [0, 100, 500, 1000, 2000, 5000];
  const histogram = bins.map((bin, index) => {
    const nextBin = bins[index + 1] || Infinity;
    const count = latencies.filter(time => time >= bin && time < nextBin).length;
    return {
      range: `${bin}-${nextBin === Infinity ? '∞' : nextBin}ms`,
      count
    };
  });

  const option = {
    title: {
      text: '',
      textStyle: { fontSize: 12 }
    },
    tooltip: {
      trigger: 'axis'
    },
    xAxis: {
      type: 'category',
      data: histogram.map(item => item.range)
    },
    yAxis: {
      type: 'value'
    },
    series: [{
      type: 'bar',
      data: histogram.map(item => item.count),
      itemStyle: { color: '#fa8c16' }
    }]
  };

  latencyChart.setOption(option);
};

// 生命周期
onMounted(() => {
  nextTick(() => {
    initCharts();
  });

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    responseTimeChart?.resize();
    tokenSpeedChart?.resize();
    successRateChart?.resize();
    modelComparisonChart?.resize();
    latencyChart?.resize();
  });
});

onUnmounted(() => {
  // 清理图表
  responseTimeChart?.dispose();
  tokenSpeedChart?.dispose();
  successRateChart?.dispose();
  modelComparisonChart?.dispose();
  latencyChart?.dispose();

  // 停止监控
  if (isMonitoring.value) {
    performanceMonitor.stopMonitoring();
  }
});

// 监听自动刷新
watch(autoRefresh, (newValue) => {
  if (newValue && !isMonitoring.value) {
    startMonitoring();
  } else if (!newValue && isMonitoring.value) {
    performanceMonitor.stopMonitoring();
    isMonitoring.value = false;
  }
});
</script>

<style scoped>
.stream-monitor {
  padding: 16px;
  background: var(--background-color, #fff);
  border-radius: 8px;
}

.monitor-controls {
  margin-bottom: 16px;
  padding: 16px;
  background: var(--card-background, #f5f5f5);
  border-radius: 6px;
}

.metrics-cards {
  margin-bottom: 16px;
}

.charts-container {
  margin-bottom: 16px;
}

.chart-container {
  height: 250px;
  width: 100%;
}

.logs-container {
  margin-bottom: 16px;
}

.logs-content {
  background: #000;
  color: #fff;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 4px;
}

.log-item {
  margin-bottom: 4px;
  padding: 2px 0;
}

.log-item.info {
  color: #1890ff;
}

.log-item.success {
  color: #52c41a;
}

.log-item.error {
  color: #ff4d4f;
}

.log-item.warning {
  color: #fa8c16;
}

.log-time {
  color: #666;
  margin-right: 8px;
}

.log-model {
  color: #52c41a;
  margin-right: 8px;
  font-weight: bold;
}

.log-message {
  margin-right: 8px;
}

.log-metrics {
  color: #666;
  font-size: 11px;
}

.alerts-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1000;
  max-width: 400px;
}

.test-results {
  margin-top: 16px;
  max-height: 300px;
  overflow-y: auto;
}

/* 深色模式适配 */
body.dark-mode .stream-monitor {
  background: var(--background-color, #141414);
}

body.dark-mode .monitor-controls {
  background: var(--card-background, #1f1f1f);
}

body.dark-mode .logs-content {
  background: #000;
  border: 1px solid #434343;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .stream-monitor {
    padding: 8px;
  }

  .charts-container .ant-col {
    margin-bottom: 16px;
  }

  .alerts-container {
    position: relative;
    top: 0;
    right: 0;
    margin-bottom: 16px;
  }
}
</style>