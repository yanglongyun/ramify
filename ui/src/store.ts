// 界面状态。真相在服务端:先 GET /api/state 拿全量,再订阅 /api/events(SSE)接增量。
// 当前打开的项目树整棵存在这里;节点事件来了就替换对应节点。SSE 断开再连上时重拉全量。
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import type { Config, Id, LogLine, Project, Run, Tree, TreeNode } from './types';

export type State = {
    config: Config | null;
    projects: Project[];
    runs: Run[];
    tree: Tree | null;
    connected: boolean;
};

const initial: State = { config: null, projects: [], runs: [], tree: null, connected: false };

export function useApp(projectId: Id | null) {
    const [state, setState] = useState<State>(initial);
    const [toast, setToast] = useState<string | null>(null);
    const current = useRef<Id | null>(projectId);
    current.current = projectId;

    const showToast = useCallback((text: string) => {
        setToast(text);
        setTimeout(() => setToast((now) => (now === text ? null : now)), 2600);
    }, []);

    const refresh = useCallback(async () => {
        const snap = await api.state();
        setState((s) => ({ ...s, config: snap.config, projects: snap.projects, runs: snap.runs, connected: true }));
    }, []);

    const loadTree = useCallback(async (id: Id) => {
        const [tree, { runs }] = await Promise.all([api.tree(id), api.runs(id)]);
        if (current.current !== id) return;
        setState((s) => ({ ...s, tree, runs: mergeRuns(s.runs, runs) }));
    }, []);

    useEffect(() => {
        refresh().catch((error) => showToast(`连不上本地服务:${error.message}`));
    }, [refresh, showToast]);

    useEffect(() => {
        if (!projectId) { setState((s) => ({ ...s, tree: null })); return; }
        loadTree(projectId).catch((error) => showToast(error.message));
    }, [projectId, loadTree, showToast]);

    useEffect(() => {
        const events = new EventSource(api.eventsUrl());
        let dropped = false;
        events.onerror = () => { dropped = true; setState((s) => ({ ...s, connected: false })); };
        events.onopen = () => {
            if (!dropped) return;
            dropped = false;
            void refresh();
            if (current.current) void loadTree(current.current);
        };
        events.onmessage = (message) => {
            const event = JSON.parse(message.data);
            switch (event.type) {
                case 'node': {
                    const node = event.node as TreeNode;
                    setState((s) => {
                        if (!s.tree || s.tree.project.id !== node.project_id) return s;
                        const nodes = s.tree.nodes.some((n) => n.id === node.id)
                            ? s.tree.nodes.map((n) => (n.id === node.id ? { ...node, seq: n.seq } : n))
                            : [...s.tree.nodes, { ...node, seq: s.tree.nodes.length + 1 }];
                        return { ...s, tree: { ...s.tree, nodes } };
                    });
                    break;
                }
                case 'run': {
                    const run = event.run as Run;
                    setState((s) => ({ ...s, runs: mergeRuns(s.runs, [run]) }));
                    if (run.status === 'failed' && run.error) showToast(`生成失败:${run.error}`);
                    // 批次结束后项目列表的计数变了
                    if (run.status !== 'running') void refresh();
                    break;
                }
                case 'log': {
                    const line: LogLine = { kind: event.kind, text: event.text, at: event.at };
                    setState((s) => ({
                        ...s,
                        runs: s.runs.map((run) => (run.id === event.run_id ? { ...run, log: [...run.log, line].slice(-60) } : run)),
                    }));
                    break;
                }
                case 'config':
                    setState((s) => ({ ...s, config: event.config }));
                    break;
                case 'project':
                    void refresh();
                    break;
                default:
            }
        };
        return () => events.close();
    }, [refresh, loadTree, showToast]);

    return { state, toast, showToast, refresh, loadTree };
}

function mergeRuns(existing: Run[], incoming: Run[]): Run[] {
    const byId = new Map(existing.map((run) => [run.id, run]));
    for (const run of incoming) {
        const old = byId.get(run.id);
        byId.set(run.id, { ...run, log: run.log?.length ? run.log : old?.log || [] });
    }
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
