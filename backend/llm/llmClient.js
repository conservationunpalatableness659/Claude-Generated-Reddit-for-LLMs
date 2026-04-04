/**
 * LLM Client — supports Ollama and LM Studio as local backends.
 *
 * Ollama default: http://localhost:11434
 * LM Studio default: http://localhost:1234
 *
 * Uses built-in fetch (Node 18+). No external HTTP libraries needed.
 */

const BACKENDS = {
  ollama: process.env.OLLAMA_URL || 'http://localhost:11434',
  lmstudio: process.env.LMSTUDIO_URL || 'http://localhost:1234',
};

const TIMEOUT_MS = 60000; // 60s per request

/**
 * Generate text via Ollama's /api/generate endpoint.
 */
async function generateOllama(model, systemPrompt, userPrompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKENDS.ollama}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
        options: {
          temperature: 0.85,
          num_predict: 250,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data.response) throw new Error('Ollama returned empty response');
    return data.response.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate text via LM Studio's OpenAI-compatible /v1/chat/completions endpoint.
 */
async function generateLMStudio(model, systemPrompt, userPrompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKENDS.lmstudio}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 250,
        temperature: 0.85,
        top_p: 0.9,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LM Studio returned empty content');
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate text using a custom OpenAI-compatible endpoint (e.g. llama.cpp server).
 */
async function generateOpenAICompat(baseUrl, model, systemPrompt, userPrompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 250,
        temperature: 0.85,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Main entry point. Dispatches to the correct backend.
 * @param {object} agent - agent object with .model and .personality
 * @param {string} userPrompt - the task/context prompt
 * @param {string} backend - 'ollama' | 'lmstudio' | 'openai-compat'
 * @param {string} [customUrl] - used when backend === 'openai-compat'
 */
async function generate(agent, userPrompt, backend = 'ollama', customUrl = '') {
  const systemPrompt = agent.personality;
  const model = agent.model;

  switch (backend) {
    case 'lmstudio':
      return generateLMStudio(model, systemPrompt, userPrompt);
    case 'openai-compat':
      return generateOpenAICompat(customUrl || BACKENDS.lmstudio, model, systemPrompt, userPrompt);
    case 'ollama':
    default:
      return generateOllama(model, systemPrompt, userPrompt);
  }
}

/**
 * Check if a backend is reachable.
 */
async function checkBackend(backend) {
  try {
    const url = backend === 'ollama'
      ? `${BACKENDS.ollama}/api/tags`
      : `${BACKENDS.lmstudio}/v1/models`;

    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { generate, checkBackend, BACKENDS };
