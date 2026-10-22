// 端到端:真起本地服务,用一个假的 Responses 服务当模型。不需要 launcher。
// 假模型看到占位节点 id 就逐个调 write_node,分叉时先 read_tree 再写。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { startServer } from '../server/index.js';
import { renderNode } from '../server/render.js';
import { outline } from '../server/agent/functions/nodes.js';

const cleanups = [];
after(async () => { for (const fn of cleanups) await fn(); });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ramify-'));

function respond(res, output) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { total_tokens: 100 } } })}\n\n`);
    res.end();
}
const said = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (name, args) => ({ type: 'function_call', call_id: `c_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) });
const lastText = (request) => {
    const last = request.input[request.input.length - 1];
    if (last.type === 'message') return last.content.map((p) => p.text).join('');
    if (last.type === 'function_call_output') return JSON.parse(last.output).text;
    return '';
};

/** 假模型:第一次请求从任务里抠出占位节点 id,每次写一个;写完后说一句话结束。 */
async function fakeModel(behaviour) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const request = JSON.parse(body);
            requests.push(request);
            behaviour(request, res, requests.length);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((r) => server.close(r)));
    return { requests, url: `http://127.0.0.1:${server.address().port}/v1/responses` };
}

async function boot(modelUrl) {
    const data = tmp();
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ responsesUrl: modelUrl, apiKey: 'test-key', model: 'fake', someoneElses: 'keep' }));
    const app = await startServer({ workspace: tmp(), data });
    cleanups.push(() => app.close());
    const http = async (method, url, body) => {
        const res = await fetch(`http://127.0.0.1:${app.port}${url}`, {
            method, headers: { 'x-iimos-token': app.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json().catch(() => null), raw: res };
    };
    const waitRun = async (id) => {
        for (let i = 0; i < 200; i += 1) {
            const { body } = await http('GET', `/api/projects/${id}/runs`);
            if (body.runs.every((run) => run.status !== 'running')) return body.runs;
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('批次没有结束');
    };
    return { app, data, http, waitRun };
}

/** 从任务文本里抠占位节点 id:「xxxxxxxxxxxx(方案 1)」 */
const placeholderIds = (text) => [...text.matchAll(/([0-9a-f]{12})\(方案 \d+\)/g)].map((m) => m[1]);

test('令牌:没带或带错都拒', async () => {
    const model = await fakeModel(() => {});
    const { app } = await boot(model.url);
    const res = await fetch(`http://127.0.0.1:${app.port}/api/state`);
    assert.equal(res.status, 401);
    const bad = await fetch(`http://127.0.0.1:${app.port}/api/state`, { headers: { 'x-iimos-token': 'nope' } });
    assert.equal(bad.status, 401);
});

test('生成一轮:三个占位节点都被 agent 写上,然后从一个节点分叉', async () => {
    const written = new Set();
    const model = await fakeModel((request, res) => {
        const text = lastText(request);
        // 任务说明在第一条用户消息里;后面的请求最后一条是工具结果
        const task = request.input.find((item) => item.type === 'message' && item.role === 'user').content.map((p) => p.text).join('');
        const ids = placeholderIds(task);
        const pending = ids.filter((id) => !written.has(id));
        if (ids.length && pending.length) {
            // 分叉任务里带着父节点内容:先 read_tree 看一眼,再写
            if (task.includes('要在它的基础上分叉') && !request.input.some((item) => item.type === 'function_call' && item.name === 'read_tree')) {
                return respond(res, [call('read_tree', { project_id: task.match(/项目 ([0-9a-f]{12})/)[1] })]);
            }
            const id = pending[0];
            written.add(id);
            const types = ['html', 'markdown', 'svg'];
            const type = types[written.size % 3];
            const content = type === 'html' ? `<html><body><h1>方案 ${written.size}</h1></body></html>` : type === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>' : `# 方案 ${written.size}\n\n正文`;
            return respond(res, [call('write_node', { id, title: `方向 ${written.size}`, type, content })]);
        }
        assert.ok(!/还有 \d+ 个占位节点没写/.test(text), '写完了还说没写完');
        return respond(res, [said('三版分别走了三个方向。')]);
    });
    const { http, waitRun, data } = await boot(model.url);

    const created = await http('POST', '/api/projects', { prompt: '做一张海报', count: 3 });
    assert.equal(created.status, 201);
    assert.equal(created.body.nodes.length, 3);
    const projectId = created.body.project.id;
    let runs = await waitRun(projectId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'completed', JSON.stringify(runs[0]));
    assert.ok(runs[0].log.some((line) => line.kind === 'message' && line.text.includes('三个方向')));

    let tree = (await http('GET', `/api/projects/${projectId}/tree`)).body;
    const root = tree.nodes.find((n) => n.parent_id === null);
    assert.equal(root.title, '做一张海报');
    const variants = tree.nodes.filter((n) => n.parent_id === root.id);
    assert.equal(variants.length, 3);
    assert.ok(variants.every((n) => n.content && ['html', 'markdown', 'svg'].includes(n.type)), JSON.stringify(variants));
    assert.deepEqual(variants.map((n) => n.title), ['方向 1', '方向 2', '方向 3']);
    // 第一次请求的指令里有角色提示词;工具里有三个
    assert.ok(model.requests[0].instructions.includes('你是 ramify'));
    assert.deepEqual(model.requests[0].tools.map((t) => t.name).sort(), ['read_tree', 'shell', 'write_node']);

    // 渲染:三种类型各出一份完整 HTML
    for (const node of variants) {
        const res = await fetch(`http://127.0.0.1:${(await http('GET', '/api/state')).raw.url.match(/:(\d+)/)[1]}/api/nodes/${node.id}/html?token=nope`);
        assert.equal(res.status, 401);
        const page = await http('GET', `/api/nodes/${node.id}/source`);
        assert.equal(page.body.node.id, node.id);
        assert.ok(renderNode(node).startsWith('<!DOCTYPE html>'));
    }

    // 从第一个方案分叉两版:旧方案不动,新的长在「轮」节点下面
    const picked = variants[0];
    const branched = await http('POST', `/api/nodes/${picked.id}/branch`, { prompt: '更红一点', count: 2 });
    assert.equal(branched.status, 201);
    assert.equal(branched.body.round.title, '更红一点');
    assert.equal(branched.body.nodes.length, 2);
    runs = await waitRun(projectId);
    assert.equal(runs.length, 2);
    assert.equal(runs[1].status, 'completed', JSON.stringify(runs[1]));
    // 分叉任务里带了父节点的完整内容,假模型也调了 read_tree
    const branchTask = model.requests.find((r) => lastText(r).includes('更红一点'));
    assert.ok(lastText(branchTask).includes(picked.content));
    assert.ok(runs[1].log.some((line) => line.text === 'read_tree'));

    tree = (await http('GET', `/api/projects/${projectId}/tree`)).body;
    const round = tree.nodes.find((n) => n.parent_id === picked.id);
    assert.equal(round.type, 'text');
    const children = tree.nodes.filter((n) => n.parent_id === round.id);
    assert.equal(children.length, 2);
    assert.ok(children.every((n) => n.content && n.type !== 'error'), JSON.stringify(children));
    assert.equal(tree.nodes.find((n) => n.id === picked.id).content, picked.content);
    assert.equal(tree.nodes.length, 1 + 3 + 1 + 2);

    // 项目列表的计数
    const state = (await http('GET', '/api/state')).body;
    assert.equal(state.projects[0].done_count, 5);
    assert.equal(state.projects[0].generating_count, 0);
    // config.json 里别人的字段原样还在
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).someoneElses, 'keep');
    // 大纲里能看到层级
    assert.match(outline(tree.nodes), /^- \[.*做一张海报.*\n  - \[/);
});

test('模型报错:批次失败,没写的占位节点标成 error;停下也一样', async () => {
    let mode = 'fail';
    const model = await fakeModel((request, res) => {
        if (mode === 'fail') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: '模型拒绝了' } })); }
        // hang:一直不回,等被停下
        cleanups.push(() => res.end());
    });
    const { http, waitRun } = await boot(model.url);
    const created = await http('POST', '/api/projects', { prompt: '失败试试', count: 2 });
    const runs = await waitRun(created.body.project.id);
    assert.equal(runs[0].status, 'failed');
    assert.match(runs[0].error, /模型拒绝了/);
    const tree = (await http('GET', `/api/projects/${created.body.project.id}/tree`)).body;
    const variants = tree.nodes.filter((n) => n.parent_id !== null);
    assert.ok(variants.every((n) => n.type === 'error' && /模型拒绝了/.test(n.content)));

    mode = 'hang';
    const second = await http('POST', '/api/projects', { prompt: '停下试试', count: 1 });
    await new Promise((r) => setTimeout(r, 50));
    const stop = await http('POST', `/api/runs/${second.body.run.id}/stop`);
    assert.equal(stop.body.stopped, true);
    const stopped = await waitRun(second.body.project.id);
    assert.equal(stopped[0].status, 'stopped');
    const tree2 = (await http('GET', `/api/projects/${second.body.project.id}/tree`)).body;
    assert.match(tree2.nodes.find((n) => n.parent_id !== null).content, /停下/);

    // 删项目
    const del = await http('DELETE', `/api/projects/${second.body.project.id}`);
    assert.equal(del.status, 200);
    assert.equal((await http('GET', `/api/projects/${second.body.project.id}/tree`)).status, 404);
});

test('没配模型时不让生成', async () => {
    const data = tmp();
    const app = await startServer({ workspace: tmp(), data });
    cleanups.push(() => app.close());
    const res = await fetch(`http://127.0.0.1:${app.port}/api/projects`, { method: 'POST', headers: { 'x-iimos-token': app.token, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x', count: 1 }) });
    assert.equal(res.status, 400);
});
