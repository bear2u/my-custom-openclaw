import { App } from '@slack/bolt'
import type { Config } from '../config.js'

// 환경변수 설정에서 Slack 앱 생성
export function createSlackApp(config: Config): App {
  return new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  })
}
