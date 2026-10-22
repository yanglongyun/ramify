// 路由只有两屏:首页(#/)和画布(#/p/<id>)。模型配置是一层浮在上面的表单。
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useApp } from './store';
import { Home } from './components/Home';
import { Canvas } from './components/Canvas';
import { Setup } from './components/Setup';

function readRoute(): string | null {
    const match = location.hash.match(/^#\/p\/([\w-]+)$/);
    return match ? match[1] : null;
}

export function App() {
    const [projectId, setProjectId] = useState<string | null>(readRoute);
    const { state, toast, showToast, refresh, loadTree } = useApp(projectId);
    const [setupOpen, setSetupOpen] = useState(false);
    const { config, projects, runs, tree } = state;

    useEffect(() => {
        const onHash = () => setProjectId(readRoute());
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    // 没接上模型就弹出配置
    useEffect(() => { if (config && !config.ready) setSetupOpen(true); }, [config]);

    const go = useCallback((id: string | null) => {
        const token = new URLSearchParams(location.search).get('token') || '';
        history.pushState(null, '', `${location.pathname}?token=${encodeURIComponent(token)}${id ? `#/p/${id}` : '#/'}`);
        setProjectId(id);
    }, []);

    const saveConfig = useCallback(async (patch: Record<string, string>) => {
        await api.saveConfig(patch);
        await refresh();
        setSetupOpen(false);
    }, [refresh]);

    const onCreate = useCallback(async (prompt: string, count: number) => {
        const { project } = await api.createProject(prompt, count);
        go(project.id);
    }, [go]);
    const onDelete = useCallback(async (id: string) => {
        try { await api.deleteProject(id); await refresh(); } catch (error) { showToast((error as Error).message); }
    }, [refresh, showToast]);
    const onBranch = useCallback(async (nodeId: string, prompt: string, count: number) => {
        await api.branch(nodeId, prompt, count);
        if (projectId) await loadTree(projectId);
    }, [projectId, loadTree]);
    const onStop = useCallback((runId: string) => { void api.stopRun(runId).catch((error) => showToast(error.message)); }, [showToast]);

    const ready = Boolean(config?.ready);
    return (
        <>
            {projectId && tree && tree.project.id === projectId
                ? <Canvas tree={tree} runs={runs.filter((run) => run.project_id === projectId)} ready={ready}
                    onBack={() => go(null)} onBranch={onBranch} onStop={onStop} onSetup={() => setSetupOpen(true)} onToast={showToast} />
                : projectId
                    ? <div className="loading">打开画布…</div>
                    : <Home projects={projects} ready={ready} onCreate={onCreate} onOpen={go} onDelete={onDelete} onSetup={() => setSetupOpen(true)} />}
            {setupOpen && <Setup config={config} onSave={saveConfig} onClose={() => setSetupOpen(false)} />}
            {toast && <div className="toast">{toast}</div>}
        </>
    );
}
