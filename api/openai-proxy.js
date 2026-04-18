import { authorizeRequest, setCors } from './_auth-utils.js';

const DEBUG_LOGS = String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' || process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  const auth = await authorizeRequest(req, res);
  if (!auth || !auth.ok) return;

  try {
    const {
      api = 'chat_completions',
      messages,
      model = "gpt-5-nano",
      max_tokens = 1000,
      max_completion_tokens,
      max_output_tokens = 1000,
      temperature,
      input
    } = req.body || {};

    const chatMaxCompletionTokens = max_completion_tokens ?? max_tokens;

    /** Models that only accept default sampling — omit temperature (API default 1). */
    const omitSamplingParams = /^gpt-5/i.test(model) || /^o[0-9]/i.test(model);

    const isResponsesApi = api === 'responses' || (!!input && !messages);
    const endpoint = isResponsesApi
      ? 'https://api.openai.com/v1/responses'
      : 'https://api.openai.com/v1/chat/completions';
    const body = isResponsesApi
      ? (() => {
          const b = {
            model,
            input: input || '',
            max_output_tokens
          };
          if (!omitSamplingParams && temperature != null) {
            b.temperature = temperature;
          }
          return b;
        })()
      : (() => {
          const b = {
            model,
            messages,
            max_completion_tokens: chatMaxCompletionTokens
          };
          if (!omitSamplingParams && temperature != null) {
            b.temperature = temperature;
          }
          return b;
        })();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    logError('OpenAI API error:', error);
    return res.status(500).json({ 
      error: 'Failed to get AI response',
      details: error.message 
    });
  }
}
