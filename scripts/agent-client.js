// 唯一调后端的地方：/api/agent、/api/summary、/api/compare、/api/story、/api/poster
// 后端是无状态的，每次都要把完整 state 带过去。

const API_BASE = '';

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`后端返回 ${response.status}: ${text}`);
  }

  return response.json();
}

export async function askAgent(state, question) {
  if (!question || !question.trim()) return '';
  const data = await postJson('/api/agent', { state, question: question.trim() });
  return data.answer || '';
}

export async function generateSummary(state) {
  const data = await postJson('/api/summary', { state, history: state.history });
  return data.result || '';
}

// 多基地对比
export async function compareBases(statesWithMetrics) {
  const data = await postJson('/api/compare', { states: statesWithMetrics });
  return data.result || '';
}

// 生成“基地一日”叙事片段
export async function generateStory(state) {
  const data = await postJson('/api/story', { state });
  return data.result || '';
}

// 生成招募海报 / 口号
export async function generatePoster(state) {
  const data = await postJson('/api/poster', { state });
  return data.result || '';
}

// Agent 主动建议下一步
export async function suggestNext(state) {
  const data = await postJson('/api/suggest', { state });
  return data.result || '';
}
