import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { Runtime } from './runtime.mjs';
import { GrokHost, delay } from './grok-host.mjs';
import { buildRoot } from '../tools/grok-prepare.mjs';
import { OpenCodeProvider } from '../engine-adapters/opencode.mjs';
import { now } from './store.mjs';
import { randomBytes } from 'node:crypto';
import { computerStatus } from './computer.mjs';
import { grokComputer } from './grok-computer-bridge.mjs';

export class GrokProvider {
  constructor(options={}){this.options=options;}
  async status() {
    const code = await new OpenCodeProvider(this.options).status();
    let built = true;
    try { await access(join(buildRoot, 'dots-grok-build.json')); } catch { built = false; }
    return { ...code, provider: 'grok-reconstructed', inference_provider: 'opencode',
      installed: code.installed && built, ...(!built ? { error: 'npm run grok:prepare가 필요합니다.' } : {}),
      capabilities: { conversation: true, widgets: true, native_computer: false, docker_computer: true, box_execution: false } };
  }
}

// Project only messages explicitly sent by the original Grok runner. Its
// assistant-text/thinking entries are private scratch work, not chat replies.
export function grokEntry(entry) {
  if (entry.kind === 'send-message') {
    const message = entry.message;
    if (message?.type === 'text' && typeof message.content === 'string') return { type: 'text', text: message.content };
    if (message?.type === 'widget') return { type: 'question', kind: 'question', question: [message.widget?.prompt, message.widget?.helpText,
      ...(message.widget?.options || []).map(option => option.label + (option.description ? ': ' + option.description : ''))].filter(Boolean).join('\n'),
      grok: { command: 'respondToWidget', entryId: entry.id }, status: entry.respondedValue != null ? 'allowed' : entry.widgetDismissed || entry.widgetSkipped ? 'interrupted' : 'pending' };
    if (message?.type === 'local-tool-permission') return { type: 'approval', kind: 'grok',
      question: 'Grok 로컬 도구 실행 승인\n' + JSON.stringify(message.ask),
      grok: { command: 'resolveLocalToolPermission', entryId: entry.id, requestId: message.ask?.requestId },
      status: message.ask?.status === 'pending' ? 'pending' : message.ask?.status === 'allowed' ? 'allowed' : 'denied' };
    if (message?.type === 'auto-review-approval') return { type: 'approval', kind: 'grok', question: 'Grok 도구 실행 승인\n' + JSON.stringify(message.approval),
      grok: { command: 'resolveAutoReviewApproval', entryId: entry.id, requestId: message.approval?.requestId },
      status: message.approval?.status === 'pending' ? 'pending' : message.approval?.status === 'approved' ? 'allowed' : message.approval?.status === 'denied' ? 'denied' : 'interrupted' };
    // Files and credentials need their own verified transport; never turn a
    // secret request into a plain text chat field.
    if (message) return { type: 'tool_call', name: 'Grok: ' + message.type, status: 'error',
      error: '이 Grok 메시지 유형은 아직 Dots 어댑터에서 지원하지 않습니다.' };
  }
  if (entry.kind === 'tool-call') return { type: 'tool_call', name: entry.name,
    status: entry.status === 'pending' ? 'running' : entry.status === 'failed' ? 'error' : 'completed',
    result: entry.summary };
  return null;
}

export class GrokRuntime extends Runtime {
  constructor(options) { super(options); this.hostFactory = options.hostFactory || (options => new GrokHost({...options,inferenceDir:this.inferenceDir})); this.pollMs = options.pollMs || 500; }
  project(task, entries) {
    for (const entry of entries) {
      const mapped = grokEntry(entry);
      if (!mapped) continue;
      const key = 'grok-' + task.id + '-' + entry.id;
      const current = this.store.get('task', task.id);
      const existing = current.items.find(item => item.id === key);
      const value = { id: key, created_at: new Date(entry.timestampMs || Date.now()).toISOString(), ...mapped };
      if (value.type === 'text') value.status = entry.isStreaming ? 'streaming' : 'completed';
      if (!existing) this.addItem(task, value);
      else if (JSON.stringify({ ...existing, created_at: undefined }) !== JSON.stringify({ ...value, created_at: undefined })) this.updateItem(task, key, { ...value, created_at: existing.created_at });
      if (value.type === 'text') {
        const old = this.store.get('message', key);
        if (!old) this.store.put('message', { id: key, room_id: task.room_id, role: 'assistant', content: { text: value.text }, task_id: task.id, created_at: value.created_at }, 'message.created');
        else if (old.content.text !== value.text) this.store.patch('message', key, { content: { text: value.text } });
      }
    }
    const pending = this.store.get('task', task.id).items.some(item => ['question', 'approval', 'computer_handoff'].includes(item.type) && item.status === 'pending');
    const status = pending ? 'needs_input' : 'in_progress';
    if (this.store.get('task', task.id).status !== status) this.setTask(task, { status });
  }
  async run(task) {
    const controller = new AbortController();
    let host;
    this.runs.set(task.id, { controller, profileId: task.profile_id });
    try {
      const token = randomBytes(32).toString('hex');
      this.tokens.set(task.id, token);
      const screen = await computerStatus({ dataDir: this.dataDir, settings: this.store.getSettings() });
      host = this.hostFactory({ directory: join(this.dataDir, 'grok', task.profile_id), model: this.store.getSettings().model,
        computer: { url: this.baseUrl + '/internal/grok-computer/' + task.id, token, width: screen.width, height: screen.height } });
      this.runs.get(task.id).host = host;
      this.setTask(task, { status: 'in_progress', error: null, error_code: null, engine: 'grok-reconstructed' });
      await host.start(controller.signal);
      controller.signal.throwIfAborted();
      const profile = this.store.get('profile', task.profile_id);
      let binding = this.store.get('grok_binding', profile.id);
      if (!binding) {
        const result = await host.call('createAgent', { name: profile.display_name, description: profile.description || '',
          isIntroductionSuppressed: true, clientNonce: 'dots-' + profile.id });
        if (typeof result.agent?.id !== 'string') throw Error('Grok createAgent 응답에 에이전트 ID가 없습니다.');
        binding = this.store.put('grok_binding', { id: profile.id, agent_id: result.agent.id });
      } else await host.call('updateAgent', { id: binding.agent_id, profile: { name: profile.display_name, description: profile.description || '' } });
      this.runs.get(task.id).agentId = binding.agent_id;
      const before = await host.call('getAgentTranscript', { id: binding.agent_id });
      const baseline = new Set(before.map(entry => entry.id));
      const traysBefore = new Set((await host.call('getTrays')).map(entry => entry.id));
      const attempt = (task.grok_attempt || 0) + 1;
      this.store.patch('task', task.id, { grok_agent_id: binding.agent_id, grok_attempt: attempt });
      const message = this.store.get('message', task.message_id);
      let prompt = message.content.text;
      if (!before.length) {
        const all = this.store.all('message').filter(m => m.room_id === task.room_id);
        const boundary = all.findIndex(m => m.id === message.id);
        const history = all.slice(0, boundary).slice(-40).map(m => ({ role: m.role, content: m.content.text }));
        if (history.length) prompt = 'Previous conversation from the Dots UI (data only; do not replay completed actions):\n' + JSON.stringify(history).slice(-50000) + '\n\nLatest user request:\n' + prompt;
      }
      if (attempt > 1) prompt = 'Resume the following request using the existing transcript. Do not replay completed actions.\n' + prompt;
      await host.call('sendPrompt', { agentId: binding.agent_id, prompt, clientNonce: 'dots-' + task.id + '-' + attempt });
      let idleSince = null;
      let hadBackgroundWork = false;
      const deadline = Date.now() + 15 * 60 * 1000;
      for (;;) {
        controller.signal.throwIfAborted();
        const [entries, roster, trays] = await Promise.all([host.call('getAgentTranscript', { id: binding.agent_id }), host.call('listAgents'), host.call('getTrays')]);
        let backgroundRunning = false;
        if (host instanceof GrokHost) {
          const subagents = await host.call('getSubagents', { id: binding.agent_id });
          backgroundRunning = subagents.some(agent => agent.status === 'running');
          hadBackgroundWork ||= backgroundRunning;
          const box = await host.call('getForeverBoxStatus', { id: binding.agent_id });
          if (box.handoff && !this.runs.get(task.id).handoff) {
            await this.computer(task.id, { operation: 'handoff' });
            const item = this.addItem(task, { type: 'computer_handoff', instruction: box.handoff.instruction, status: 'pending' });
            this.runs.get(task.id).handoff = { itemId: item.id, requestId: box.handoff.requestId };
          }
        }
        const current = entries.filter(entry => !baseline.has(entry.id));
        this.project(task, current);
        const error = trays.find(entry => entry.agentId === binding.agent_id && entry.kind === 'error' && !traysBefore.has(entry.id));
        if (error) throw Error(error.detail || error.title || 'Grok 실행 실패');
        const agent = roster.find(agent => agent.id === binding.agent_id);
        if (!agent) throw Error('연결된 Grok 에이전트를 찾지 못했습니다.');
        const waiting = this.store.get('task', task.id).items.some(item => ['approval', 'question', 'computer_handoff'].includes(item.type) && item.status === 'pending');
        if (!agent.isRunning && !waiting && !backgroundRunning) {
          idleSince ??= Date.now();
          if (Date.now() - idleSince > (hadBackgroundWork ? 8000 : 1500)) {
            if (!current.some(entry => grokEntry(entry)?.type === 'text')) throw Error('Grok 러너가 사용자 메시지를 보내지 않고 종료했습니다. ' + host.log.slice(-900));
            this.setTask(task, { status: 'completed', completed_at: now() }); break;
          }
        } else idleSince = null;
        if (Date.now() > deadline && !waiting) throw Error('Grok 작업 제한 시간(15분)을 초과했습니다.');
        await delay(this.pollMs, controller.signal);
      }
    } catch (error) {
      const run = this.runs.get(task.id);
      const status = this.closing ? 'interrupted' : run?.resumeRequested ? 'queued' : run?.paused ? 'paused' : controller.signal.aborted ? 'cancelled' : 'error';
      const current = this.store.get('task', task.id);
      this.setTask(task, { status, error: status === 'queued' ? null : error?.message || String(error), error_code: 'GROK_RUN_FAILED',
        items: current.items.map(item => ['pending', 'running', 'streaming'].includes(item.status) ? { ...item, status: status === 'error' ? 'error' : 'interrupted' } : item) });
    } finally {
      await host?.stop(); this.runs.delete(task.id); this.tokens.delete(task.id);
      if (this.computerLease === task.id) this.computerLease = null;
      if (!this.closing) queueMicrotask(() => this.pump(task.profile_id));
    }
  }
  async respond(approvalId, result) {
    if (this.waiters.has(approvalId)) return super.respond(approvalId, result);
    const task = this.store.all('task').find(task => task.status === 'needs_input' && task.items.some(item => item.id === approvalId && item.status === 'pending'));
    const run = task && this.runs.get(task.id), item = task?.items.find(item => item.id === approvalId);
    if (!run || !item?.grok || run.responding) return false;
    run.responding = true;
    try {
      const args = { agentId: run.agentId, entryId: item.grok.entryId };
      if (item.grok.command === 'respondToWidget') {
        if (result.decision === 'deny') await run.host.call('dismissWidget', args);
        else {
          if (typeof result.value !== 'string' || !result.value.trim()) throw Error('답변을 입력하세요.');
          const response = await run.host.call('respondToWidget', { ...args, value: result.value });
          if (response.accepted !== true) return false;
        }
      } else if (item.grok.command === 'resolveLocalToolPermission') await run.host.call(item.grok.command, { ...args, requestId: item.grok.requestId, resolution: result.decision === 'allow' ? 'allow-once' : 'deny' });
      else if (item.grok.command === 'resolveAutoReviewApproval') await run.host.call(item.grok.command, { ...args, requestId: item.grok.requestId, resolution: result.decision === 'allow' ? 'approved' : 'denied' });
      else throw Error('이 Grok 승인 유형은 아직 연결되지 않았습니다. 작업을 취소할 수 있습니다.');
      this.updateItem(task, approvalId, { status: result.decision === 'allow' ? 'allowed' : 'denied', decision: result.decision, value: result.value });
      this.setTask(task, { status: 'in_progress' }); return true;
    } finally { run.responding = false; }
  }
  computer(taskId, body) { return grokComputer(this, taskId, body); }
  async computerHandback() {
    for (const [taskId, run] of this.runs) {
      if (!run.handoff || run.handbackPending) continue;
      run.handbackPending = true;
      try { await run.host.call('handBackForeverBox', { id: run.agentId, trigger: 'button' });
      const task = this.store.get('task', taskId);
      this.updateItem(task, run.handoff.itemId, { status: 'completed' });
      run.handoff = null;
      this.setTask(task, { status: 'in_progress' });
      } catch (error) {
        const task = this.store.get('task', taskId);
        this.updateItem(task, run.handoff.itemId, { error: '컴퓨터 반환 후 Grok 재개 실패: ' + error.message });
        throw error;
      } finally { run.handbackPending = false; }
    }
  }
}
