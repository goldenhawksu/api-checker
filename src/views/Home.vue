<template>
  <div class="home-container">
    <h1 class="home-title">🚀 API Checker - 本地开发版 v2.2.2 ✨</h1>
    <p class="home-subtitle">实时热重载演示 - {{ currentTime }}</p>
    <ApiForm />
  </div>
</template>

<script>
import ApiForm from '../components/Check.vue';
import { ref, onMounted, onUnmounted } from 'vue';

export default {
  name: 'Home',
  components: {
    ApiForm,
  },
  setup() {
    const currentTime = ref(new Date().toLocaleTimeString());

    let timer = null;

    onMounted(() => {
      // 每秒更新时间，演示响应式更新
      timer = setInterval(() => {
        currentTime.value = new Date().toLocaleTimeString();
      }, 1000);
    });

    onUnmounted(() => {
      if (timer) {
        clearInterval(timer);
      }
    });

    return {
      currentTime,
    };
  },
};
</script>

<style scoped>
.home-container {
  padding: 20px;
  text-align: center;
}

.home-title {
  color: #1890ff;
  margin-bottom: 10px;
  font-size: 2.5em;
}

.home-subtitle {
  color: #666;
  margin-bottom: 30px;
  font-size: 1.2em;
}
</style>
