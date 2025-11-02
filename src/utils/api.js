export async function fetchModelList(apiUrl, apiKey) {
  const apiUrlValue = apiUrl.replace(/\/+$/, '');
  const response = await fetch(`${apiUrlValue}/v1/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  return await response.json();
}

export async function fetchQuotaInfo(apiUrl, apiKey) {
  const trimmedApiUrl = apiUrl.replace(/\/+$/, '');
  const authHeader = { Authorization: `Bearer ${apiKey}` };

  // Fetch subscription data
  const quotaResponse = await fetch(
    `${trimmedApiUrl}/dashboard/billing/subscription`,
    {
      headers: authHeader,
    }
  );
  const quotaData = await quotaResponse.json();
  const quotaInfo = quotaData.hard_limit_usd ? quotaData.hard_limit_usd : null;

  // Fetch usage data
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-${day}`;

  const usageResponse = await fetch(
    `${trimmedApiUrl}/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
    {
      headers: authHeader,
    }
  );
  const usageData = await usageResponse.json();
  const usedInfo = usageData.total_usage / 100;

  return {
    quotaInfo,
    usedInfo,
  };
}

export async function testModelList(
  apiUrl,
  apiKey,
  modelNames,
  timeoutSeconds,
  concurrency,
  progressCallback,
  options = {}
) {
  const {
    enableStream = false,
    includeComparison = false,
    customPrompt = '写一个10个字的冷笑话'
  } = options;

  const valid = [];
  const invalid = [];
  const inconsistent = [];
  const awaitOfficialVerification = [];
  const streamResults = [];

  async function testModel(model) {
    const apiUrlValue = apiUrl.replace(/\/+$/, '');
    let timeout = timeoutSeconds * 1000; // 转换为毫秒

    // 对于特定模型增加超时时间
    if (model.startsWith('o1-')) {
      // o1系列模型需要更长的推理时间
      timeout *= 6;
    } else if (model.toLowerCase().includes('deepseek-r1') || model.toLowerCase().includes('deepseek_r1')) {
      // DeepSeek-R1模型包含思维链推理，需要更长时间
      timeout = Math.max(timeout * 5, 60000); // 至少60秒
    } else if (model.toLowerCase().includes('claude')) {
      // Claude模型也需要较长的处理时间
      timeout = Math.max(timeout * 3, 30000); // 至少30秒
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    let response_text;
    try {
      // 非流式测试
      if (!enableStream) {
        const requestBody = {
          model: model,
          messages: [{ role: 'user', content: customPrompt }],
        };
        if (/^(gpt-|chatgpt-)/.test(model)) {
          requestBody.seed = 331;
        }
        const response = await fetch(`${apiUrlValue}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        const endTime = Date.now();
        const responseTime = (endTime - startTime) / 1000; // 转换为秒

        let has_o1_reason = false;
        if (response.ok) {
          const data = await response.json();
          const returnedModel = data.model || 'no returned model';

          // 检查 'o1-' 模型的特殊字段
          if (
            returnedModel.startsWith('o1-') &&
            data?.usage?.completion_tokens_details?.reasoning_tokens > 0
          ) {
            has_o1_reason = true;
          }

          // 🔧 增强性能指标收集 - 提取响应内容和计算Token指标
          const content = data.choices?.[0]?.message?.content || '';
          const contentLength = content.length;

          // 估算token数（简单估算：字符数作为token数的近似值）
          // 注意：这是粗略估算，实际应该用tokenizer
          const estimatedTokens = contentLength;

          // 计算TTFB（首字节时间）- 非流式模式下等于总响应时间
          const ttfb = responseTime * 1000; // 转换为毫秒

          // 计算tokens/s
          const tokensPerSecond = responseTime > 0 ?
            (estimatedTokens / responseTime).toFixed(2) : 0;

          if (returnedModel === model) {
            const resultData = {
              model,
              responseTime,
              ttfb,                    // 🆕 TTFB (毫秒)
              tokenCount: estimatedTokens,  // 🆕 Token数量
              tokensPerSecond,         // 🆕 Token速率
              contentLength,           // 🆕 响应内容长度
              has_o1_reason,
              type: 'non-stream'       // 🆕 标识为非流式测试
            };
            valid.push(resultData);
            progressCallback({
              type: 'valid',
              data: resultData,
            });
          } else {
            const resultData = {
              model,
              returnedModel,
              responseTime,
              ttfb,                    // 🆕 TTFB
              tokenCount: estimatedTokens,  // 🆕 Token数量
              tokensPerSecond,         // 🆕 Token速率
              contentLength,           // 🆕 响应内容长度
              has_o1_reason,
              type: 'non-stream'       // 🆕 标识为非流式测试
            };
            inconsistent.push(resultData);
            progressCallback({
              type: 'inconsistent',
              data: resultData,
            });
          }
        } else {
          // 🔧 增强HTTP错误处理 - 提供更友好的错误提示
          let response_text = '';
          let error_type = '';

          try {
            const jsonResponse = await response.json();
            response_text = jsonResponse.error?.message || JSON.stringify(jsonResponse);

            // 根据HTTP状态码提供更清晰的错误类型
            if (response.status === 401) {
              error_type = '认证失败';
            } else if (response.status === 404) {
              error_type = '模型不存在';
            } else if (response.status === 500) {
              error_type = '服务器错误';
            } else if (response.status === 503) {
              error_type = '服务不可用';
            } else if (response.status === 524) {
              error_type = '请求超时';
            } else {
              error_type = `HTTP ${response.status}`;
            }
          } catch (jsonError) {
            try {
              response_text = await response.text();
              error_type = `HTTP ${response.status}`;
            } catch (textError) {
              response_text = '无法解析响应内容';
              error_type = `HTTP ${response.status}`;
            }
          }

          const resultData = {
            model,
            response_text: error_type ? `[${error_type}] ${response_text}` : response_text,
            http_status: response.status,
            error_type
          };
          invalid.push(resultData);
          progressCallback({
            type: 'invalid',
            data: resultData,
          });
        }
      } else {
        // 流式测试
        const streamResult = await testStreamModel(
          apiUrlValue,
          apiKey,
          model,
          customPrompt,
          controller,
          startTime
        );

        if (streamResult.success) {
          const resultData = {
            model,
            ...streamResult.metrics,
            type: 'stream'
          };
          streamResults.push(resultData);
          valid.push(resultData);
          progressCallback({
            type: 'streamValid',
            data: resultData,
          });
        } else if (streamResult.isEmpty && !streamResult.error) {
          // 流式返回空（HTTP 200但无数据），标记为"流式不可用"而非完全失败
          const resultData = {
            model,
            ...streamResult.metrics,
            warning: '流式模式无数据，建议使用非流式模式',
            type: 'stream-empty'
          };
          // 仍然加入valid列表，但标记为需要警告
          valid.push(resultData);
          progressCallback({
            type: 'streamEmpty',
            data: resultData,
          });
        } else {
          const resultData = {
            model,
            error: streamResult.error || '流式测试失败',
            type: 'stream'
          };
          invalid.push(resultData);
          progressCallback({
            type: 'streamInvalid',
            data: resultData,
          });
        }
      }
    } catch (error) {
      // 🔧 增强异常处理 - 识别不同类型的错误
      let error_message = error.message;
      let error_type = '未知错误';

      if (error.name === 'AbortError') {
        error_type = '请求超时';
        error_message = '请求超时，请增加超时时间或检查网络连接';
      } else if (error.message && error.message.includes('Failed to fetch')) {
        error_type = '网络错误';
        error_message = '网络连接失败，请检查网络连接或API地址';
      } else if (error.message && (error.message.includes('IncompleteRead') || error.message.includes('Connection broken'))) {
        error_type = '连接中断';
        error_message = '连接中断，可能是服务器或网络问题';
      } else if (error.message && error.message.includes('timeout')) {
        error_type = '请求超时';
        error_message = '请求超时';
      }

      const resultData = {
        model,
        error: error_message,
        error_type,
        response_text: `[${error_type}] ${error_message}`
      };
      invalid.push(resultData);
      progressCallback({
        type: 'invalid',
        data: resultData,
      });
    } finally {
      clearTimeout(id);
    }
  }

  async function runBatch(models) {
    const promises = models.map(model =>
      testModel(model).catch(error => {
        console.error(`测试模型 ${model} 时发生错误：${error.message}`);
        progressCallback({
          type: 'error',
          data: { model, error: error.message }
        });
      })
    );
    await Promise.all(promises);
  }

  for (let i = 0; i < modelNames.length; i += concurrency) {
    const batch = modelNames.slice(i, i + concurrency);
    await runBatch(batch);
  }

  // 如果需要对比测试，执行非流式测试
  if (includeComparison && enableStream) {
    progressCallback({
      type: 'comparisonStarted',
      data: { message: '开始对比测试...' }
    });

    for (const model of modelNames) {
      try {
        // 这里可以添加非流式测试逻辑
        // 暂时跳过以避免重复测试
      } catch (error) {
        console.error(`对比测试模型 ${model} 失败:`, error);
      }
    }
  }

  return { valid, invalid, inconsistent, awaitOfficialVerification, streamResults };
}

/**
 * 测试流式模型
 */
async function testStreamModel(apiUrl, apiKey, model, prompt, controller, startTime) {
  try {
    const requestBody = {
      model: model,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    };

    if (/^(gpt-|chatgpt-)/.test(model)) {
      requestBody.seed = 331;
    }

    const response = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const metrics = {
      ttfb: null,
      firstTokenTime: null,
      lastTokenTime: null,
      tokenCount: 0,
      totalTime: 0,
      chunks: []
    };

    let buffer = '';
    let firstTokenReceived = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // 记录首字节时间
        if (!metrics.ttfb && buffer.length > 0) {
          metrics.ttfb = Date.now() - startTime;
        }

        // 解析SSE数据
        // 注意：SSE数据以\n\n分隔每个事件，但某些情况下可能只用\n
        // 我们需要确保只处理完整的行，不完整的行保留在buffer中
        let lines;
        if (buffer.endsWith('\n')) {
          // buffer以换行符结尾，说明所有行都是完整的
          lines = buffer.split('\n');
          buffer = '';
        } else {
          // buffer不以换行符结尾，说明最后一行可能不完整
          lines = buffer.split('\n');
          buffer = lines.pop() || '';  // 保留最后一个不完整的行
        }

        for (const line of lines) {
          // 跳过空行
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            continue;
          }

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6).trim();
            if (data === '[DONE]') {
              break;
            }

            // 跳过空数据
            if (!data) {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              metrics.chunks.push(parsed);

              // 检查是否有内容
              // 注意：某些模型(如DeepSeek-R1)的第一个chunk的choices可能为空数组
              // 需要检查choices存在且长度大于0
              if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices.length > 0) {
                const delta = parsed.choices[0].delta || {};

                // 检查delta中是否有content字段
                if (delta.content !== undefined && delta.content !== null) {
                  // 即使content为空字符串，也算作一个有效的chunk
                  // 但只有非空content才计入token数
                  if (delta.content) {
                    metrics.tokenCount++;

                    if (!firstTokenReceived) {
                      metrics.firstTokenTime = Date.now() - startTime;
                      firstTokenReceived = true;
                    }

                    metrics.lastTokenTime = Date.now() - startTime;
                  }
                }
              }
            } catch (parseError) {
              // JSON解析失败 - 这通常发生在DeepSeek-R1的content_filter_results字段被切断时
              // 这些失败的chunk通常不包含实际的content数据，可以安全忽略
              // 只记录debug信息，不影响测试结果
              console.debug('SSE parse error (chunk may be incomplete):', parseError.message, '- Data preview:', data.substring(0, 100));
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 计算总时间
    const endTime = Date.now();
    metrics.totalTime = (endTime - startTime) / 1000;

    // 判断测试是否成功：需要收到至少一个token
    // 注意：某些模型可能在流式模式下不返回数据，但非流式正常
    const success = metrics.tokenCount > 0;
    const isEmpty = metrics.tokenCount === 0;

    return {
      success: success,
      isEmpty: isEmpty,  // 标记是否为空响应
      metrics: {
        ...metrics,
        tokensPerSecond: metrics.tokenCount > 0 ?
          (metrics.tokenCount / metrics.totalTime).toFixed(2) : 0
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// GPT Refresh Tokens
export function checkRefreshTokens(apiAddress, tokens) {
  return fetch(apiAddress, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'refreshTokens',
      tokens: tokens,
    }),
  }).then(response => response.json());
}

// Claude Session Keys
export function checkSessionKeys(
  apiAddress,
  tokens,
  maxAttempts,
  requestsPerSecond
) {
  return fetch(apiAddress, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'sessionKeys',
      tokens: tokens,
      maxAttempts: maxAttempts,
      requestsPerSecond: requestsPerSecond,
    }),
  }).then(response => response.json());
}

// Gemini Keys
export function checkGeminiKeys(
  apiAddress,
  tokens,
  model,
  rateLimit,
  prompt,
  user
) {
  return fetch(apiAddress, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'geminiAPI',
      tokens: tokens,
      model: model,
      rateLimit: rateLimit,
      prompt: prompt,
      user: user,
    }),
  }).then(response => response.json());
}
