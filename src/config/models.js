// API模型配置文件
// 移除硬编码模型列表，改为动态从API获取
// 更新时间: 2025-11-01
// 说明:
//   - SUPPORTED_MODELS, MODEL_CATEGORIES, DEFAULT_MODELS, RECOMMENDED_MODELS 已移除
//   - 理由: API /v1/models 接口提供完整实时的模型列表
//   - 原硬编码遗漏了28个API支持的模型，包含了10个API不存在的模型
//   - 保留智能超时配置，因为这是有价值的性能优化

// 智能超时配置 - 基于模型特性的超时时间（秒）
export const MODEL_TIMEOUTS = {
  // 推理模型需要更长时间（包含思维链）
  'DeepSeek-R1': 60,
  'deepseek-reasoner': 60,
  'deepseek-v3.1-think': 60,

  // Claude思考模型
  'claude-3-7-sonnet-20250219-thinking': 120,
  'claude-4-sonnet-think': 90,
  'claude-4.5-sonnet-think': 90,
  'claude-4.1-opus-think': 120,
  'claude-haiku-4.5-think': 60,

  // Gemini思考模型
  'gemini-2.5-pro-think': 90,
  'gemini-2.5-flash-think': 60,

  // GPT思考模型
  'gpt-5-think': 90,

  // O1系列模型（推理时间长）
  'o1': 180,
  'o1-mini': 120,
  'o1-preview': 180,

  // 快速响应模型
  'gpt-4o-mini': 15,
  'gpt-4.1-mini': 15,
  'gpt-4.1-nano': 10,
  'gpt-5-mini': 15,
  'claude-haiku-4.5': 15,
  'claude-haiku-4-5-20251001': 15,
  'gemini-2.0-flash-lite': 15,
  'gemini-flash-lite-latest': 15,

  // 标准模型
  'gpt-4': 30,
  'gpt-4o': 30,
  'gpt-4-turbo': 30,
  'gpt-4.1': 30,
  'claude-3-sonnet': 30,
  'claude-3.7-sonnet': 30,
  'claude-4-sonnet': 30,
  'claude-4.5-sonnet': 30,
  'gemini-2.0-flash': 30,
  'gemini-2.5-flash': 30,
  'gemini-2.5-pro': 45,

  // 大型模型
  'claude-opus': 45,
  'claude-4.1-opus': 60,
  'gpt-5': 45,
  'grok-4': 45,
  'llama-3.1-405b': 60,

  // 默认超时（未在上述列表中的模型）
  'default': 30
};

/**
 * 获取模型的推荐超时时间
 * @param {string} model - 模型名称
 * @returns {number} 超时时间（秒）
 */
export const getModelTimeout = (model) => {
  // 精确匹配
  if (MODEL_TIMEOUTS[model]) {
    return MODEL_TIMEOUTS[model];
  }

  // 模糊匹配 - 根据模型名称特征推断超时
  const modelLower = model.toLowerCase();

  // 推理/思考模型
  if (modelLower.includes('think') ||
      modelLower.includes('reasoning') ||
      modelLower.includes('reasoner') ||
      modelLower.includes('o1')) {
    return 120;
  }

  // 快速模型
  if (modelLower.includes('mini') ||
      modelLower.includes('nano') ||
      modelLower.includes('lite') ||
      modelLower.includes('flash') && modelLower.includes('lite')) {
    return 15;
  }

  // 大型模型
  if (modelLower.includes('opus') ||
      modelLower.includes('405b') ||
      modelLower.includes('grok-4')) {
    return 60;
  }

  // 默认
  return MODEL_TIMEOUTS['default'];
};

/**
 * 根据模型名称动态分类
 * @param {string[]} models - 模型列表
 * @returns {Object} 按系列分组的模型
 */
export const categorizeModels = (models) => {
  const categories = {
    'gpt': [],
    'claude': [],
    'gemini': [],
    'deepseek': [],
    'grok': [],
    'llama': [],
    'kimi': [],
    'glm': [],
    'o1': [],
    'other': []
  };

  models.forEach(model => {
    const modelLower = model.toLowerCase();

    if (modelLower.startsWith('gpt') || modelLower.startsWith('chatgpt')) {
      categories['gpt'].push(model);
    } else if (modelLower.startsWith('claude')) {
      categories['claude'].push(model);
    } else if (modelLower.startsWith('gemini')) {
      categories['gemini'].push(model);
    } else if (modelLower.startsWith('deepseek')) {
      categories['deepseek'].push(model);
    } else if (modelLower.startsWith('grok')) {
      categories['grok'].push(model);
    } else if (modelLower.startsWith('llama')) {
      categories['llama'].push(model);
    } else if (modelLower.startsWith('kimi')) {
      categories['kimi'].push(model);
    } else if (modelLower.startsWith('glm')) {
      categories['glm'].push(model);
    } else if (modelLower.startsWith('o1')) {
      categories['o1'].push(model);
    } else {
      categories['other'].push(model);
    }
  });

  // 移除空分类
  Object.keys(categories).forEach(key => {
    if (categories[key].length === 0) {
      delete categories[key];
    }
  });

  return categories;
};

/**
 * 检查模型是否为推理模型
 * @param {string} model - 模型名称
 * @returns {boolean}
 */
export const isReasoningModel = (model) => {
  const modelLower = model.toLowerCase();
  return modelLower.includes('think') ||
         modelLower.includes('reasoning') ||
         modelLower.includes('reasoner') ||
         modelLower.startsWith('o1');
};

/**
 * 检查模型是否为快速模型
 * @param {string} model - 模型名称
 * @returns {boolean}
 */
export const isFastModel = (model) => {
  const modelLower = model.toLowerCase();
  return modelLower.includes('mini') ||
         modelLower.includes('nano') ||
         modelLower.includes('lite') ||
         (modelLower.includes('flash') && !modelLower.includes('image'));
};

/**
 * 根据模型特性推荐测试参数
 * @param {string} model - 模型名称
 * @returns {Object} 推荐的测试参数
 */
export const getRecommendedTestParams = (model) => {
  return {
    timeout: getModelTimeout(model),
    isReasoning: isReasoningModel(model),
    isFast: isFastModel(model),
    suggestedPrompt: isReasoningModel(model) ?
      '解释量子纠缠的原理' :
      '你好'
  };
};
