import { anthropic } from '@weacle/speed-node-server/src/llms/anthropic/client'

type GetCompletionParams = {
  callback: (chunk: { content?: string | null, finishReason: CompletionFinishReason }) => void
  // maxToken?: number
  model?: string
  prompt: string
  // responseFormat?: { type: 'text' | 'json_object' }
  systemPrompt?: string
  temperature?: number
}

/**
 * @see node_modules/@anthropic-ai/sdk/src/resources/messages.ts
 */
type CompletionFinishReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null

type ChatCompletionResponse = {
  errors: { stream: string } | null
}

export default async function stream({
  callback,
  // maxToken,
  model = 'claude-3-5-sonnet-20241022',
  prompt,
  // responseFormat,
  temperature = 0,
  systemPrompt,
}: GetCompletionParams): Promise<ChatCompletionResponse> {
  try {
    anthropic.messages.stream({
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{
        role: 'user',
        content: prompt,
      }],
      model,
      max_tokens: 4096,
      temperature,
    }).on('text', (text) => {
      callback({
        content: text,
        finishReason: null,
      })
    }).on('finalMessage', (message) => {
      callback({
        finishReason: message.stop_reason,
      })
    })
      
    return { errors: null }

  } catch (error: any) {
    console.error('getCompletion:', error)

    return {
      errors: { stream: error.message || 'Failed to stream' },
    }
  }
}

