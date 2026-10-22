// 本地服务的接口。令牌在窗口地址的 ?token= 里(由 main.js 生成),每个请求都带上;iframe 的地址用 ?token=。
import type { Config, Project, Run, Tree, TreeNode } from './types';

export const token = new URLSearchParams(location.search).get('token') || '';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: { 'x-iimos-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
    return data as T;
}

export const api = {
    state: () => req<{ config: Config; workspace: { version: string }; projects: Project[]; runs: Run[] }>('GET', '/api/state'),
    saveConfig: (patch: Record<string, string>) => req<{ config: Config }>('POST', '/api/config', patch),
    createProject: (prompt: string, count: number) => req<{ project: Project; run: Run }>('POST', '/api/projects', { prompt, count }),
    deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
    tree: (id: string) => req<Tree>('GET', `/api/projects/${id}/tree`),
    runs: (id: string) => req<{ runs: Run[] }>('GET', `/api/projects/${id}/runs`),
    branch: (nodeId: string, prompt: string, count: number) => req<{ run: Run }>('POST', `/api/nodes/${nodeId}/branch`, { prompt, count }),
    source: (nodeId: string) => req<{ node: TreeNode }>('GET', `/api/nodes/${nodeId}/source`),
    stopRun: (id: string) => req<{ stopped: boolean }>('POST', `/api/runs/${id}/stop`),
    nodeHtmlUrl: (nodeId: string, revision?: string) =>
        `/api/nodes/${nodeId}/html?token=${encodeURIComponent(token)}${revision ? `&r=${encodeURIComponent(revision)}` : ''}`,
    eventsUrl: () => `/api/events?token=${encodeURIComponent(token)}`,
};
