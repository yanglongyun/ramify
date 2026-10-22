// 服务端返回的数据形状。
export type Id = string;
export type NodeType = 'text' | 'html' | 'markdown' | 'svg' | 'error';
export const ARTIFACT_TYPES: NodeType[] = ['html', 'markdown', 'svg'];
export const isArtifact = (type: NodeType) => ARTIFACT_TYPES.includes(type);

export type Project = {
    id: Id;
    title: string;
    prompt: string;
    created_at: string;
    updated_at: string;
    done_count?: number;
    generating_count?: number;
    preview_node_id?: Id | null;
};

export type TreeNode = {
    id: Id;
    project_id: Id;
    parent_id: Id | null;
    position: number;
    type: NodeType;
    title: string;
    content: string | null;
    run_id: string | null;
    created_at: string;
    updated_at: string;
    seq: number;
};

export type Tree = { project: Project; nodes: TreeNode[] };

export type LogLine = { kind: 'message' | 'call' | 'retry' | 'error'; text: string; at: string };
export type Run = {
    id: string;
    project_id: Id;
    parent_id: Id;
    prompt: string;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    error: string | null;
    created_at: string;
    finished_at: string | null;
    log: LogLine[];
};

export type Config = {
    responsesUrl: string;
    model: string;
    contextWindow: number;
    hasKey: boolean;
    keyHint: string;
    ready: boolean;
};
