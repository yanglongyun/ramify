// 活动面板:正在跑的批次在做什么(agent 说的话、调了什么工具),能停下。
import type { Run } from '../types';

export function Activity({ runs, onStop }: { runs: Run[]; onStop: (id: string) => void }) {
    const live = runs.filter((run) => run.status === 'running');
    const recent = runs.filter((run) => run.status !== 'running').slice(-2);
    const shown = [...recent, ...live];
    if (!shown.length) return null;
    return (
        <div className="activity">
            {shown.map((run) => {
                const last = run.log[run.log.length - 1];
                return (
                    <div key={run.id} className={`activity-run is-${run.status}`}>
                        <div className="activity-head">
                            <span className="activity-dot" />
                            <span className="activity-prompt" title={run.prompt}>{run.prompt}</span>
                            {run.status === 'running'
                                ? <button onClick={() => onStop(run.id)}>停</button>
                                : <span className="activity-state">{run.status === 'completed' ? '完成' : run.status === 'stopped' ? '已停' : '失败'}</span>}
                        </div>
                        {run.status === 'running' && <div className={`activity-line is-${last?.kind || 'wait'}`}>{last ? last.text : '等模型开口…'}</div>}
                        {run.status === 'failed' && run.error && <div className="activity-line is-error">{run.error}</div>}
                    </div>
                );
            })}
        </div>
    );
}
