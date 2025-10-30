# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**API-Checker** 是一个现代化的纯前端 API 测试工具，专门用于测试 OpenAI 兼容 API 的可用性和性能。该项目采用 Vue 3 + Express 前后端分离架构，支持多种部署方式，提供完整的 API 测试解决方案。

## 核心架构

### 前端架构 (Vue 3)
- **主框架**: Vue 3.5.12 + Composition API
- **UI 组件**: Ant Design Vue 4.2.6
- **路由管理**: Vue Router 4.4.5 (SPA 单页应用)
- **国际化**: Vue I18n 9.14.1 (中英文支持)
- **图表可视化**: ECharts 5.5.1
- **构建工具**: Vite 5.4.10

### 后端架构 (Express)
- **API 服务**: Express.js 4.21.1
- **认证系统**: 基于 PASSWORD 环境变量
- **存储方案**: Vercel KV (云端) + LocalStorage (本地)
- **CORS 处理**: 全域跨域支持

### 部署架构
- **Vercel**: 主要部署平台，支持 Serverless Functions
- **Docker**: 容器化部署，多阶段构建优化
- **Cloudflare**: 边缘计算部署支持
- **本地开发**: 热重载开发环境

## 常用命令

### 开发环境
```bash
# 安装依赖
yarn install

# 启用开发服务器 (前端热重载)
yarn dev
# 访问: http://localhost:3000

# 启动完整服务器 (前端+后端)
yarn start
# 访问: http://localhost:13000

# 构建生产版本
yarn build

# 预览生产构建
yarn preview
```

### Docker 部署
```bash
# 拉取并运行最新镜像
docker run -d -p 13000:13000 \
  -e PASSWORD=your_password \
  -v your_path:/app/data \
  --name api-check ghcr.io/rickcert/api-check:latest

# 本地构建和运行
docker build -t api-check .
docker run -d -p 13000:13000 -e PASSWORD=your_password api-check
```

### 代码质量
```bash
# 代码格式化
yarn prettier

# 分析构建包大小
# 构建后会自动打开可视化报告（在stats.html中查看）

# 功能测试
node test_stream_fix.js
```

### 调试和诊断
```bash
# 健康检查
curl http://localhost:13000/api/alive

# API认证测试
curl -X POST http://localhost:13000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"your_password"}'

# Docker日志查看
docker logs api-check
```

## 项目架构设计

### 前后端数据流
```
前端Vue应用 → HTTP请求 → Express后端 → 数据存储(Vercel KV/本地文件/LocalStorage)
                ↓
            响应数据 → 前端状态更新 → UI渲染
```

### 核心业务流程

#### API测试流程
1. **配置输入**: 用户输入API URL、密钥、模型列表
2. **模型获取**: 调用 `/v1/models` 获取可用模型
3. **并发测试**: 多线程并发请求测试各模型
4. **结果分析**: 响应时间统计、一致性检查、性能指标计算
5. **报告生成**: 详细的测试报告和可视化图表

#### 流式监控流程
1. **流式请求**: 发送stream=true的API请求
2. **实时解析**: StreamParser解析SSE数据
3. **性能监控**: 计算TTFB、Token速度等指标
4. **可视化展示**: 实时图表展示监控数据

## 核心功能模块

### 1. API 测试引擎 (Check.vue)
- **多模型并发测试**: 支持同时测试多个 AI 模型
- **性能指标收集**: 响应时间、TTFB、Token 生成速度
- **高级验证功能**:
  - 官方代理验证 (系统指纹检查)
  - 温度参数验证 (随机性测试)
  - 函数调用验证 (功能测试)

### 2. 存储管理系统
- **云端存储**: Vercel KV 集成，跨设备同步
- **本地缓存**: LocalStorage 持久化
- **配置管理**: JSON 格式的预设参数
- **数据安全**: 前端加密传输

### 3. 实验性功能 (Experimental.vue)
- **GPT 刷新令牌批量测试**
- **Claude 会话密钥批量测试**
- **Gemini API 密钥批量测试**

### 4. 流式监控 (StreamMonitor.vue)
- **实时监控**: Server-Sent Events 流式数据解析
- **性能指标**: TTFB、Token生成速度、延迟分析
- **可视化展示**: ECharts图表实时展示性能数据

### 5. 聊天集成
- **快速测试**: 集成 NextChat 的轻量聊天功能
- **预设配置**: URL 参数快速配置 API 设置
- **代理优化**: 支持代理网站的定制化配置

## 关键配置文件

### package.json 核心脚本
- `dev`: Vite 开发服务器 (端口 3000)
- `build`: 生产构建到 `dist/` 目录
- `start`: Express 服务器 (端口 13000)
- `docker:install`: Docker 环境依赖安装

### vite.config.js 关键配置
- **代理设置**: 开发服务器支持局域网访问
- **别名配置**: `@` 指向 `src/` 目录
- **样式处理**: Less 预处理器 + Ant Design 暗色主题
- **构建优化**: 手动代码分割 (ant-design-vue, lodash, vendor)

### server.js 路由结构
```
/api/alive  -> 健康检查接口
/api/auth   -> 身份验证接口
/api/*      -> 主要 API 接口
/*          -> SPA 前端路由 (fallback to index.html)
```

### Dockerfile 多阶段构建
1. **base**: 基础环境准备 (Node.js 18 Alpine)
2. **builder**: 应用构建和依赖安装
3. **production**: 生产镜像 (非 root 用户 + 安全配置)

## API 接口规范

### 认证接口 (/api/auth)
```javascript
POST /api/auth
{
  "password": "your_password" // 环境变量 PASSWORD
}
// 返回: { "message": "Authenticated" }
```

### 存储接口 (/api)
```javascript
// GET /api?password=xxx&key=xxx - 获取配置
// POST /api?password=xxx&key=xxx - 保存配置
// DELETE /api?password=xxx&key=xxx - 删除配置
Body: JSON 数据 (Vercel KV 或 LocalStorage 格式)
```

### 健康检查 (/api/alive)
```javascript
GET /api/alive
// 返回: { "status": "ok" }
```

## URL 参数配置系统

支持通过 URL 参数快速配置应用设置，便于代理网站集成：

```javascript
// 编码后的配置示例
https://your-domain.com/?settings={"key":"*sk*","url":"*api*","models":["gpt-4o-mini"],"timeout":10,"concurrency":2,"closeAnnouncement":true,"closeChat":true}

// 支持的配置字段:
{
  "key": "API密钥",
  "url": "API端点",
  "models": ["模型列表"],
  "timeout": 30,
  "concurrency": 3,
  "closeAnnouncement": false,  // 关闭公告显示
  "closeChat": false          // 关闭聊天功能
}
```

## 国际化配置

### 语言包结构
- `src/locales/en.json` - 英文语言包
- `src/locales/zh.json` - 中文语言包
- `src/i18n/index.js` - 国际化配置

### 主题切换
- **暗色主题**: 基于 Ant Design 的 less 变量
- **亮色主题**: 默认配置
- **自动切换**: 支持系统主题检测

## 部署相关配置

### Vercel 部署
- **构建命令**: `yarn build`
- **输出目录**: `dist`
- **环境变量**: `PASSWORD` (必需)
- **路由配置**: `vercel.json` (API 路由重写)

### Cloudflare 部署
- **适配器**: 需要特殊处理 Vercel KV 依赖
- **路由**: 直接映射 `/api` 路径
- **绑定域名**: 推荐绑定自定义域名

### Docker 安全配置
- **非 root 用户**: `appuser:appgroup` (uid:1001)
- **环境变量**: `NODE_ENV=production`, `HOSTNAME=0.0.0.0`
- **Node.js 选项**: DNS 解析优化和 OpenSSL 配置

## 开发最佳实践

### 组件设计模式
- **组合式 API**: 使用 `<script setup>` 语法
- **状态管理**: 本地状态为主，无全局状态管理
- **组件通信**: Props + Events 模式
- **样式隔离**: Scoped CSS + Ant Design 主题系统

### 性能优化策略
- **代码分割**: Vite 自动分割 + 手动配置
- **懒加载**: 路由级别的组件懒加载
- **资源优化**: 静态资源 CDN 加速
- **缓存策略**: HTTP 缓存 + Service Worker (可选)

### 错误处理机制
- **全局错误处理**: Express 错误中间件
- **API 错误捕获**: try/catch + 用户友好提示
- **网络异常**: 超时重试机制
- **数据验证**: 前端参数校验

## 安全注意事项

### 敏感信息保护
- **API 密钥**: 仅存储在前端 LocalStorage 或云端 KV
- **环境变量**: PASSWORD 用于后端认证
- **CORS 配置**: 生产环境建议限制具体域名
- **Docker 安全**: 非 root 用户 + 最小权限原则

### 网络安全
- **HTTPS 强制**: 生产环境必须使用 HTTPS
- **请求超时**: 前端可配置超时时间
- **数据加密**: 敏感数据前端加密传输
- **访问控制**: 基于 PASSWORD 的简单认证

## 故障排除指南

### 环境要求
- **Node.js**: 18+ (项目使用ES6模块)
- **包管理器**: 推荐使用 Yarn
- **端口配置**: 开发3000 / 生产13000 (可通过PORT环境变量修改)
- **环境变量**: PASSWORD (生产环境必需)

### 常见问题
1. **端口冲突**: 3000 (dev) / 13000 (prod) 端口占用
2. **环境变量**: 检查 `.env` 文件和部署平台配置
3. **CORS 错误**: 确认后端 API 路径配置正确
4. **构建失败**: 清除 `node_modules` 重新安装依赖
5. **依赖问题**: 使用 `yarn cache clean` 清理缓存后重新安装

### 调试技巧
- **开发工具**: Vue DevTools 浏览器扩展
- **网络监控**: 浏览器开发者工具 Network 面板
- **日志查看**: Docker `docker logs` 命令
- **性能分析**: Vite Bundle Analyzer 可视化报告
- **功能测试**: 运行 `node test_stream_fix.js` 验证流式功能

## 扩展开发

### 添加新的 API 测试功能
1. 在 `src/components/Check.vue` 中添加测试逻辑
2. 在 `api/index.js` 中添加后端支持 (如需要)
3. 更新语言包 `src/locales/` 添加新的文案
4. 测试兼容性并更新文档

### 集成新的存储后端
1. 创建新的 API 路由文件 `api/new-backend.js`
2. 在 `server.js` 中注册新路由
3. 更新前端存储适配器逻辑
4. 配置相应的环境变量

### 添加新的部署平台支持
1. 创建平台特定的配置文件
2. 编写部署教程文档到 `docs/` 目录
3. 更新 README.md 中的部署说明
4. 测试完整的部署流程