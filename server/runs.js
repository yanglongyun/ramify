// 生成批次:一次「生成 N 个方案」或「从某节点分叉」就是一个 run —— 一个独立的 agent 循环,有自己的上下文,
// 跑完就结束。多个 run 可以同时跑(各自一个 AbortController)。
//
// 事件推给界面(emit):
//   node   { node }                 某个节点被写入 / 标失败
//   run    { run }                  批次状态变了(开始、结束)
//   log    { run_id, kind, text }   agent 说的话、工具调用的摘要(只留最近几十条,给「活动」面板看)
import { run as runAgent } from './agent/index.js';
import { COMPACT_RATIO, KEEP, contextWindow } from './agent/compact.js';
import { outline } from './agent/functions/nodes.js';
import { message } from './ai/index.js';
import { readConfig, modelReady } from './config.js';
import { buildInstructions } from './instructions.js';
import * as store from './db.js';

const LOG_LIMIT = 60;

export class Runs {
    constructor({ db, workspace, data, bin, emit }) {
        this.db = db;
        this.workspace = workspace;
        this.data = data;
        this.bin = bin;
        this.emit = emit;
        this.active = new Map();   // run id → { controller, log: [] }
    }

    requireModel() {
        const config = readConfig(this.data);
        if (!modelReady(config)) throw Object.assign(new Error('还没配置模型'), { status: 400 });
        return config;
    }

    /** 新项目:建项目 + 根 + N 个占位,然后起一个 run。 */
    generate({ prompt, count }) {
        const config = this.requireModel();
        const runId = store.newId();
        const { project, root, placeholders } = store.createProject(this.db, { prompt, count, runId });
        const run = store.createRun(this.db, { id: runId, projectId: project.id, parentId: root.id, prompt: project.prompt });
        this.start(run, config, { project, placeholders, parent: root, task: project.prompt });
        return { project, root, placeholders, run };
    }

    /** 从节点分叉:轮节点 + N 个占位,再起一个 run。 */
    branch({ parentId, prompt, count }) {
        const config = this.requireModel();
        const runId = store.newId();
        const { parent, round, placeholders } = store.branch(this.db, { parentId, prompt, count, runId });
        const project = store.getProject(this.db, parent.project_id);
        const run = store.createRun(this.db, { id: runId, projectId: project.id, parentId: round.id, prompt: round.title });
        this.start(run, config, { project, placeholders, parent, round, task: round.title });
        this.emit({ type: 'node', node: round });
        for (const node of placeholders) this.emit({ type: 'node', node });
        return { parent, round, placeholders, run };
    }

    stop(id) {
        const entry = this.active.get(id);
        if (!entry) return false;
        entry.controller.abort();
        return true;
    }

    stopAll() {
        for (const entry of this.active.values()) entry.controller.abort();
    }

    snapshot(projectId) {
        return store.listRuns(this.db, projectId).map((run) => (this.active.has(run.id) ? { ...run, log: this.active.get(run.id).log } : run));
    }

    /** 这一批的任务说明:需求、占位节点、分叉时父节点的完整内容。 */
    taskMessage({ project, placeholders, parent, round, task }) {
        const ids = placeholders.map((node) => `${node.id}(${node.title})`).join('、');
        const lines = [`项目 ${project.id}「${project.title}」。`];
        if (round) {
            const ancestry = outline(store.listNodes(this.db, project.id), new Set([parent.id]));
            lines.push(`用户选中了节点 ${parent.id}「${parent.title}」(${parent.type}),要在它的基础上分叉。修改要求:${task}`);
            lines.push(`当前整棵树(父节点带完整内容):\n${ancestry}`);
        } else {
            lines.push(`需求:${task}`);
        }
        lines.push(`画布上已经建好 ${placeholders.length} 个占位节点等你写:${ids}。每个节点用 write_node 写一个方向明显不同的完整方案;不要新建节点,也不要漏掉任何一个。`);
        return lines.join('\n\n');
    }

    start(run, config, context) {
        const controller = new AbortController();
        const entry = { controller, log: [] };
        this.active.set(run.id, entry);
        this.emit({ type: 'run', run: { ...run, log: [] } });
        const log = (kind, text) => {
            const line = { kind, text: String(text).slice(0, 400), at: new Date().toISOString() };
            entry.log.push(line);
            if (entry.log.length > LOG_LIMIT) entry.log.shift();
            this.emit({ type: 'log', run_id: run.id, ...line });
        };
        const canvas = {
            db: this.db,
            projectId: context.project.id,
            placeholders: context.placeholders.map((node) => node.id),
            onChange: (node) => this.emit({ type: 'node', node }),
        };
        const window = contextWindow(config);
        let partial = '';
        void runAgent({
            instructions: buildInstructions(this.workspace),
            messages: [message(this.taskMessage(context))],
            model: config.model,
            config: {
                url: config.responsesUrl,
                key: config.apiKey,
                workdir: this.workspace,
                bin: this.bin,
                timeout: 120,
                max_output: 30_000,
                compact_at: Math.floor(window * COMPACT_RATIO),
                keep: KEEP,
                canvas,
            },
            signal: controller.signal,
            onEvent: (event) => {
                switch (event.type) {
                    case 'message':
                        if (event.delta) { partial += event.delta; return; }
                        partial = '';
                        if (event.item) log('message', event.item.content?.map((part) => part.text || '').join('') || '');
                        return;
                    case 'function_call': {
                        let summary = event.item.name;
                        try {
                            const args = JSON.parse(event.item.arguments);
                            if (event.item.name === 'write_node') summary = `write_node → ${args.id}「${args.title || ''}」${args.type || ''}`;
                            else if (event.item.name === 'shell') summary = `shell: ${String(args.command).slice(0, 120)}`;
                            else if (event.item.name === 'read_tree') summary = 'read_tree';
                        } catch { /* 参数不是 JSON,只记名字 */ }
                        log('call', summary);
                        return;
                    }
                    case 'retry': log('retry', `模型请求失败,${event.attempt}/${event.maxRetries} 次重试中:${event.error}`); return;
                    case 'error': log('error', event.error); return;
                    default:
                }
            },
        }).then((result) => {
            const status = result.status === 'completed' ? 'completed' : result.status === 'aborted' ? 'stopped' : 'failed';
            const error = status === 'failed' ? (entry.log.findLast((line) => line.kind === 'error')?.text || result.stopReason || '生成失败') : null;
            this.finish(run.id, status, error, entry);
        }).catch((error) => {
            this.finish(run.id, 'failed', error.message || String(error), entry);
        });
    }

    finish(id, status, error, entry) {
        const marked = store.finishRun(this.db, id, status, error, entry.log);
        this.active.delete(id);
        for (const nodeId of marked) this.emit({ type: 'node', node: store.getNode(this.db, nodeId) });
        this.emit({ type: 'run', run: store.getRun(this.db, id) });
    }
}
