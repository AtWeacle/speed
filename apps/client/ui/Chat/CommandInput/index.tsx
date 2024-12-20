import React, {
  useEffect,
  useState,
  useRef,
} from 'react'
import styled from 'styled-components'
import throttle from 'lodash/throttle'
import {
  CircleArrowUp,
  CircleStop,
  // Mic,
  // Trash2,
} from 'lucide-react'
import useWebSocket from 'react-use-websocket'

// import useStore from '@weacle/speed-client/lib/useStore'
import useProjectStore from '@weacle/speed-client/lib/useProjectStore'
import { nanoid } from '@weacle/speed-client/lib/utils/nanoid'

import { MEDIA } from '@weacle/speed-client/theme/constants'
import { WS_URL } from '@weacle/speed-client/lib/constants'
import type {
  MessageStatus,
  MessageSystem,
  SocketMessagePrompt,
} from '@weacle/speed-lib/types'

import Button from '@weacle/speed-client/ui/Button'
import Textarea from '@weacle/speed-client/ui/Textarea'
// import CircleWithAnimatedBorder from '@weacle/speed-client/ui/Recording/CircleWithAnimatedBorder'

const AUDIO_DURATION = 60
const MAX_PROMPT_LENGTH = 20000

const throttleMessageUpdate = throttle(({
  text,
  status,
}: {
  text: string
  status: MessageStatus
}) => {
  const { getActiveMessage, updateMessage } = useProjectStore.getState()
  const activeMessage = getActiveMessage()
  if (!activeMessage) return

  const update = { text, status }
  updateMessage(activeMessage.id, update)
}, 300)

const Wrapper = styled.div`
  margin: 0 auto 0;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  top: 0;
  transition: top .15s ease-in-out;

  ${MEDIA.XS} {
    margin: 0 auto 0;
    max-width: 480px;
  }

  ${MEDIA.SM} {
    max-width: 700px;
  }

  ${MEDIA.LG} {
    max-width: 840px;
  }

  .stop {
    border-radius: 2px;
    background: var(--color-red);
    width: 10px;
    height: 10px;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .circle-marker {
    border-radius: 50%;
    border: 1px solid oklch(from var(--color-red) l c h / .5);
    width: 28px;
    height: 28px;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
`
const InputWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  width: calc(100% - 19px);
  border: 2px solid var(--color-black-3);
  border-radius: calc(var(--border-radius) * 1);
  transition: border .2s ease-in-out;
  background-color: var(--color-black-3);
  position: relative;
  padding: 6px 4px 6px 10px;

  &[data-valid="false"] {
    border-color: var(--color-red);
  }

  &[data-has-content="true"] {
    svg.stop-icon path {
      fill: var(--color-black-9);
    }
  }

  &[data-has-content="true"][data-loading="true"] {
    svg.stop-icon path {
      fill: var(--color-red);
    }
  }

  svg.stop-icon {
    width: 28px;
  }

  ${MEDIA.XS} {
    svg.stop-icon {
      width: 32px;
    }
  }
/* 
  svg {
    stroke: var(--color-black-9);
  } */

  .command-input {
    min-height: 24px;
    resize: none;
    font-size: .9rem;
    color: var(--color-black-9);
    background: transparent;
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    position: relative;
    z-index: 2;
    padding: 8px 0;
    width: 100%;
    
    &::placeholder {
      color: var(--color-black-9);
    }

    ${MEDIA.XS} {
      font-size: 1rem;
    }
  }

  button {
    width: 42px;
    height: 40px;
  }
`
const Counter = styled.span`
  display: flex;
  margin: 5px 5px 0 auto;
  color: var(--color-black-5);
  font-size: .65rem;
  width: max-content;
  height: fit-content;
  position: absolute;
  bottom: -20px;
  right: 0;

  &[data-valid="false"] {
    color: var(--color-red);
  }
`
export default function CommandInput({
  showCounter = false,
}: {
  showCounter?: boolean
}) {
  const setActiveMessageId = useProjectStore(state => state.setActiveMessageId)
  const addMessage = useProjectStore(state => state.addMessage)
  const prompt = useProjectStore(state => state.prompt)
  const setPrompt = useProjectStore(state => state.setPrompt)
  const answering = useProjectStore(state => state.answering)
  const promptModel = useProjectStore(state => state.promptModel)
  const setAnswering = useProjectStore(state => state.setAnswering)
  const setErrors = useProjectStore(state => state.setErrors)
  const systemPrompt = useProjectStore(state => state.systemPrompt)

  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const drawRef = useRef<number | null>(null)
  const sendRecording = useRef<boolean>(false)

  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const streamedMessageContentRef = useRef<string>('')

  const [focused, setFocused] = useState(false)
  const valid = prompt.length <= MAX_PROMPT_LENGTH

  const { sendJsonMessage } = useWebSocket(WS_URL, {
    share: true,
    shouldReconnect: () => true,
    onMessage: (event) => {
      const { data: rawData } = event

      if (!rawData) {
        setAnswering(false)
        return
      }

      try {
        const data = JSON.parse(rawData)
        const { activeMessageId, getMessage, updateMessage } = useProjectStore.getState()

        const message = data.messageId ? getMessage(data.messageId) : null

        if (!message || message?.status === 'done') {
          setAnswering(false)
          return
        }

        if (data.text) {
          const { text } = data
          streamResponse(text, data.status)
        }

        if (data.status === 'done') {
          setAnswering(false)

          if (activeMessageId) {
            updateMessage(activeMessageId, { status: 'done' })
          }
        }

        if (data.transcription && data.messageId) {
          const { transcription, messageId } = data
          updateMessage(messageId, { text: transcription })
        }

      } catch (error) {
        console.error('Error parsing JSON data: ', error)
      }
    },
  })

  useEffect(() => {
    if (!recording) return

    setTimeout(() => {
      if (recording) endRecording()
    }, AUDIO_DURATION * 1000)

    // return () => {
    //   if (recording) endRecording()
    // }
  }, [recording])

  function onChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    setPrompt(value)
  }

  function getValue(value: string) {
    if (value === '') return ''
    if (value?.length > MAX_PROMPT_LENGTH) return value.slice(0, MAX_PROMPT_LENGTH)
    return value
  }

  function onMouseDown(event: React.MouseEvent<HTMLTextAreaElement>) {
    event.stopPropagation()
  }

  function onBlur(event: React.FocusEvent<HTMLTextAreaElement>) {
    const validatedValue = getValue(event.target.value)
    setPrompt(validatedValue)
    setFocused(false)
  }

  function onFocus() {
    setFocused(true)
    setPrompt(prompt ?? '')
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const inputElement = event.target as HTMLInputElement

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      const value = inputElement.value
      const start = inputElement.selectionStart ?? 0
      const end = inputElement.selectionEnd ?? 0
      const newValue = `${value.slice(0, start)}\n${value.slice(end)}`
      inputElement.value = newValue
      inputElement.setSelectionRange(start + 1, start + 1)

    } else if (event.key === 'Enter') {
      event.preventDefault()
      const validatedValue = getValue(inputElement.value)
      setPrompt(validatedValue)
      if (validatedValue) sendCommand(validatedValue)
      
    } else if (event.key === 'Escape') {
      setFocused(false)
      setPrompt(prompt ?? '')
      inputElement.blur()
    }

    updateHeight(event)
  }

  function updateHeight(event: React.ClipboardEvent<HTMLTextAreaElement> | React.KeyboardEvent<HTMLTextAreaElement>) {
    const inputElement = event.target as HTMLTextAreaElement
    setTimeout(() => {
      inputElement.style.height = 'auto'
      const computedStyle = window.getComputedStyle(inputElement)
      const paddingTop = parseInt(computedStyle.getPropertyValue('padding-top'), 10)
      const paddingBottom = parseInt(computedStyle.getPropertyValue('padding-bottom'), 10)
      const height = Math.max(24, Math.min(inputElement.scrollHeight - paddingTop - paddingBottom, 150))
      inputElement.style.height = `${height}px`
    }, 0)
  }

  function streamResponse(text: string, status: MessageStatus = 'pending') {
    streamedMessageContentRef.current += text
    throttleMessageUpdate({ text: streamedMessageContentRef.current, status })
  }

  async function sendCommand(prompt: string) {
    if (!prompt) return
    await sendCommandMutation({ prompt })
  }

  async function sendCommandMutation({
    audio,
    prompt,
  }: {
    audio?: Blob
    prompt?: string
  }) {
    if (answering) return

    const {
      clearMessages,
      filesToExclude,
      filesToInclude,
      pathsToExclude,
      path,
      selectedItems,
    } = useProjectStore.getState()

    clearMessages()
    const audioUrl = audio ? URL.createObjectURL(audio) : undefined

    const userMessageId = nanoid()
    addMessage({ id: userMessageId, audio: audioUrl, text: prompt?.trim(), role: 'user' })
    setPrompt('')
    streamedMessageContentRef.current = ''

    const systemMessageId = nanoid()
    const systemMessage: MessageSystem = { id: systemMessageId, status: 'pending', role: 'system' }
    addMessage(systemMessage)
    setActiveMessageId(systemMessageId)

    const thread = document.querySelector('#t38hArd')
    if (thread) {
      setTimeout(() => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }), 500)
    }

    // const audioBase64 = audio ? await convertBlobToBase64(audio) : null
    // const messageIdToTranscribe = audio ? userMessageId : undefined
    setAnswering(true)

    sendJsonMessage<SocketMessagePrompt>({
      // audio: audioBase64,
      // messageIdToTranscribe,
      directory: path,
      messageId: systemMessageId,
      model: promptModel,
      selectedItems,
      settings: {
        filesToExclude,
        filesToInclude,
        pathsToExclude,
      },
      systemPrompt,
      text: prompt?.trim(),
      type: 'prompt',
    })
  }

  function handleSend(event: React.SyntheticEvent<HTMLButtonElement | HTMLAnchorElement>) {
    sendCommand(prompt)
    setPrompt('')

    const inputElement = document.querySelector('.command-input') as HTMLTextAreaElement
    inputElement.style.height = 'auto'
  }

  function handleCancel() {
    setAnswering(false)
    const { getActiveMessage, updateMessage } = useProjectStore.getState()
    const activeMessage = getActiveMessage()
    if (!activeMessage) return
    updateMessage(activeMessage.id, { status: 'done' })
  }

  function handleCancelRecording() {
    setAnswering(false)
    endRecording(true)
    setErrors({})
  }

  function endRecording(cancel: boolean = false) {
    sendRecording.current = !cancel
    mediaRecorderRef.current?.stop()
    document.dispatchEvent(new CustomEvent('audioDataEnd'))

    if (drawRef.current) {
      cancelAnimationFrame(drawRef.current)
      drawRef.current = null
    }

    setRecording(false)
  }

  async function handleMic() {
    if (recording) return endRecording()
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new window.AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 32
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const draw = () => {
        analyser.getByteFrequencyData(dataArray)
        document.dispatchEvent(new CustomEvent('audioData', { detail: [...dataArray] }))
        drawRef.current = requestAnimationFrame(draw)
      }

      draw()

      mediaRecorderRef.current = new MediaRecorder(stream)
      audioChunksRef.current = []

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data)
      }

      mediaRecorderRef.current.onstop = () => {
        if (sendRecording.current) {
          sendRecording.current = false
          
          const audioBlob = new Blob(audioChunksRef.current, { 'type': 'audio/mpeg' })
          sendCommandMutation({ audio: audioBlob })
        }

        stream.getTracks().forEach(track => track.stop())

        if (drawRef.current) {
          cancelAnimationFrame(drawRef.current)
        }
      }

      mediaRecorderRef.current.start()
      setRecording(true)
      
    } catch (error) {
      console.error('Error accessing the microphone: ', error)
    }
  }


  return (
    <Wrapper>
      <InputWrapper
        data-focused={focused ? 'true' : 'false'}
        data-valid={valid ? 'true' : 'false'}
        data-loading={answering ? 'true' : 'false'}
        data-has-content={prompt.length ? 'true' : 'false'}
        ref={inputWrapperRef}
      >
        <Textarea
          className="command-input"
          autoComplete="off"
          rows={1}
          dir="auto"
          spellCheck={false}
          placeholder={"Type a prompt..."}
          value={prompt ?? ''}
          onMouseDown={onMouseDown}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCut={updateHeight} 
          onCopy={updateHeight} 
          onPaste={updateHeight} 
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={answering}
        />

        {!answering ? <Button
          onClick={handleSend}
          appearance="text"
          title="Send"
          style={{ padding: '0', width: '38px' }}
        >
          <CircleArrowUp size={38} strokeWidth={1.4} color={prompt.length ? 'var(--color-black-9)' : 'var(--color-black-6)'} />
        </Button>
        : <Button
          onClick={handleCancel}
          appearance="text"
          title="Stop"
          style={{ padding: '0', width: '38px' }}
        >
          <CircleStop size={38} strokeWidth={1.4} color={'var(--color-red)'} />
        </Button>}
        
        {/* {!recording
          ? prompt.length > 0 ? <Button
            onClick={handleSend}
            appearance="text"
            title="Send"
            style={{ paddingRight: '7px', paddingLeft: '5px', width: '50px' }}
          >
            <CircleArrowUp size={40} strokeWidth={1.4} />
          </Button> : <Button
            onClick={handleMic}
            appearance="text"
            disabled={!valid}
            style={{ paddingRight: '7px', paddingLeft: '5px', width: '50px' }}
          >
            <Mic size={30} strokeWidth={1.7} />
          </Button>
          : <>
            <Button
              onClick={handleCancelRecording}
              appearance="text"
              title="Cancel"
              style={{ paddingRight: '5px', paddingLeft: '5px', position: 'relative' }}
            >
              <Trash2 size={30} strokeWidth={1.7} />
            </Button>
            <Button
              onClick={handleMic}
              appearance="text"
              title="Stop"
              style={{ paddingRight: '5px', paddingLeft: '5px', position: 'relative' }}
            >
              <CircleWithAnimatedBorder duration={AUDIO_DURATION} />
              <span className="stop"></span>
              <span className="circle-marker"></span>
            </Button>
          </>
        } */}

        {MAX_PROMPT_LENGTH && showCounter ?
          <Counter
            data-valid={valid ? 'true' : 'false'}
          >
            {prompt.length} / {MAX_PROMPT_LENGTH}
          </Counter>
        : null}
      </InputWrapper>
    </Wrapper>
  )
}
