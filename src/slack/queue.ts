import { EventEmitter } from 'events'

export interface QueueItem {
  id: string
  channel: string
  messageTs: string
  threadTs?: string
  userId: string
  text: string
  files?: string[]
  provider?: 'claude' | 'codex'
  enqueuedAt: number
}

interface ChannelQueueState {
  channel: string
  queue: QueueItem[]
  active: QueueItem | null
  abortController: AbortController | null
  draining: boolean
}

export const MAX_QUEUE_SIZE = 10

/**
 * 채널별 메시지 큐 시스템
 * OpenClaw의 command-queue.ts 패턴을 적용:
 * - Lane(채널)별 독립 큐
 * - drain + pump 패턴으로 순차 실행
 * - AbortController로 작업 취소 지원
 */
export class MessageQueue extends EventEmitter {
  private queues = new Map<string, ChannelQueueState>()

  private getQueue(channel: string): ChannelQueueState {
    let state = this.queues.get(channel)
    if (!state) {
      state = {
        channel,
        queue: [],
        active: null,
        abortController: null,
        draining: false,
      }
      this.queues.set(channel, state)
    }
    return state
  }

  /**
   * 큐에 메시지 추가
   * @param item 큐 아이템 (id, enqueuedAt 자동 생성)
   * @param options.cancelCurrent true면 현재 작업 취소 후 시작
   * @returns position: 0이면 바로 시작, >0이면 대기 순번, -1이면 큐 가득참
   */
  add(
    item: Omit<QueueItem, 'id' | 'enqueuedAt'>,
    options: { cancelCurrent?: boolean } = {}
  ): { position: number; cancelled: boolean; queueFull: boolean } {
    const state = this.getQueue(item.channel)

    console.log(`[Queue] add() - channel: ${item.channel}, active: ${state.active?.id || 'none'}, queue.length: ${state.queue.length}, draining: ${state.draining}`)

    // 큐 가득 참 확인 (취소 옵션이면 무시)
    if (!options.cancelCurrent && state.queue.length >= MAX_QUEUE_SIZE) {
      return { position: -1, cancelled: false, queueFull: true }
    }

    let cancelled = false

    // 현재 작업 취소 옵션
    if (options.cancelCurrent && state.active) {
      this.cancelCurrent(item.channel)
      cancelled = true
    }

    const queueItem: QueueItem = {
      ...item,
      id: Math.random().toString(36).substring(2, 15),
      enqueuedAt: Date.now(),
    }

    state.queue.push(queueItem)
    this.drain(item.channel)

    // 현재 처리 중인 항목이 방금 추가한 것이면 position=0
    const position = state.active?.id === queueItem.id
      ? 0
      : state.queue.findIndex(q => q.id === queueItem.id) + 1

    console.log(`[Queue] add() result - position: ${position}, active: ${state.active?.id || 'none'}, queueItem.id: ${queueItem.id}`)

    return { position, cancelled, queueFull: false }
  }

  /**
   * OpenClaw drain + pump 패턴
   * 큐에서 다음 작업을 꺼내 실행
   */
  private drain(channel: string): void {
    const state = this.getQueue(channel)
    console.log(`[Queue] drain() - channel: ${channel}, draining: ${state.draining}, active: ${state.active?.id || 'none'}, queue.length: ${state.queue.length}`)

    if (state.draining) {
      console.log(`[Queue] drain() - already draining, skipping`)
      return
    }
    state.draining = true

    const pump = () => {
      // 이미 실행 중이거나 큐가 비었으면 종료
      if (state.active || state.queue.length === 0) {
        console.log(`[Queue] pump() - stopping: active=${state.active?.id || 'none'}, queue.length=${state.queue.length}`)
        state.draining = false
        return
      }

      const item = state.queue.shift()!
      state.active = item
      state.abortController = new AbortController()

      console.log(`[Queue] pump() - starting item: ${item.id}, emitting 'process'`)
      // 'process' 이벤트 발생 (handler에서 구독)
      this.emit('process', item, state.abortController.signal)
    }

    pump()
  }

  /**
   * 작업 완료 시 호출
   * 다음 대기 작업이 있으면 자동으로 시작
   * @returns 다음 시작될 아이템 (없으면 null)
   */
  complete(channel: string): QueueItem | null {
    const state = this.getQueue(channel)
    state.active = null
    state.abortController = null
    state.draining = false  // 드레인 상태 리셋 (다음 drain 호출이 실행되도록)

    console.log(`[Queue] complete() - channel: ${channel}, queue.length: ${state.queue.length}`)

    // 다음 항목 미리 확인 (drain 전에)
    const next = state.queue.length > 0 ? state.queue[0] : null

    // drain 호출하여 다음 작업 시작
    this.drain(channel)

    return next
  }

  /**
   * 현재 실행 중인 작업 취소
   * AbortController.abort() 호출
   */
  cancelCurrent(channel: string): boolean {
    const state = this.getQueue(channel)
    if (!state.active) return false

    if (state.abortController) {
      state.abortController.abort()
    }
    state.active = null
    state.abortController = null
    return true
  }

  /**
   * 대기 중인 모든 작업 취소
   * 현재 실행 중인 작업은 영향 없음
   */
  clearPending(channel: string): number {
    const state = this.getQueue(channel)
    const count = state.queue.length
    state.queue = []
    return count
  }

  /**
   * 현재 실행 중인 작업 + 대기 중인 모든 작업 취소
   * @returns { cancelledCurrent: 현재 작업 취소 여부, clearedPending: 대기열에서 제거된 수 }
   */
  clearAll(channel: string): { cancelledCurrent: boolean; clearedPending: number } {
    const cancelledCurrent = this.cancelCurrent(channel)
    const clearedPending = this.clearPending(channel)
    return { cancelledCurrent, clearedPending }
  }

  /**
   * 큐 상태 조회
   */
  getStatus(channel: string): {
    current: QueueItem | null
    pending: QueueItem[]
    total: number
  } {
    const state = this.getQueue(channel)
    return {
      current: state.active,
      pending: [...state.queue],
      total: state.queue.length + (state.active ? 1 : 0),
    }
  }

  /**
   * 현재 처리 중인 작업이 있는지 확인
   */
  isProcessing(channel: string): boolean {
    return this.getQueue(channel).active !== null
  }
}

// 싱글톤 인스턴스
export const messageQueue = new MessageQueue()

// 서버 시작 시 로그
console.log('[Queue] MessageQueue initialized (singleton)')
